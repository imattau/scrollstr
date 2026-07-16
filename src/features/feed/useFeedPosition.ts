import { useEffect, useMemo, useRef, useState } from 'react'
import type { VideoItemData } from './VideoFeedItem'
import { markVideosSeen, getSeenVideoIds } from '../../nostr/cache'

const FEED_STATE_KEY = 'scrollstr-feed-state'
const SEEN_FLUSH_INTERVAL_MS = 5000

interface UseFeedPositionInput {
  initialVideoId: string | null
  feedType: string
  filterTag: string | null
  videos: VideoItemData[]
  activeIndex: number
  setActiveIndex: (index: number) => void
}

interface UseFeedPositionOutput {
  deeplinkFailed: boolean
  deeplinkPending: boolean
  activeVideoIdRef: React.MutableRefObject<string | null>
}

function getMediaStackViewport(): HTMLElement | null {
  return document.querySelector('.media-stack-viewport') as HTMLElement | null
}

function scrollToIndex(index: number) {
  const vp = getMediaStackViewport()
  if (!vp) return
  const height = vp.clientHeight
  vp.scrollTo({ top: index * height, behavior: 'instant' })
  vp.dispatchEvent(new Event('scroll'))
}

export function useFeedPosition(input: UseFeedPositionInput): UseFeedPositionOutput {
  const { initialVideoId, feedType, filterTag, videos, activeIndex, setActiveIndex } = input

  const [deeplinkFailed, setDeeplinkFailed] = useState(false)
  const deeplinkFoundRef = useRef(false)
  const activeVideoIdRef = useRef<string | null>(null)
  const initialScrollDoneRef = useRef(false)
  const prevInitialVideoIdRef = useRef(initialVideoId)

  // Reset scroll guard when the deep link target changes mid-session
  // (e.g. user navigates from /?v=ID1 to /?v=ID2 without remounting VideoFeed).
  useEffect(() => {
    if (initialVideoId !== prevInitialVideoIdRef.current) {
      prevInitialVideoIdRef.current = initialVideoId
      initialScrollDoneRef.current = false
      deeplinkFoundRef.current = false
      setDeeplinkFailed(false)
    }
  }, [initialVideoId])

  // Track the active video ID so we can restore position when new events arrive
  useEffect(() => {
    const video = videos[activeIndex]
    if (video) {
      activeVideoIdRef.current = video.id
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex])

  const deeplinkPending = !!initialVideoId && !videos.some(v => v.id === initialVideoId)

  // Timeout for deep link failure
  useEffect(() => {
    if (!initialVideoId) return
    if (deeplinkFoundRef.current) return
    const timer = setTimeout(() => {
      if (!deeplinkFoundRef.current) {
        setDeeplinkFailed(true)
      }
    }, 10000)
    return () => clearTimeout(timer)
  }, [initialVideoId])

  // Mark deep link as found when video appears
  useEffect(() => {
    if (!initialVideoId) return
    if (videos.some(v => v.id === initialVideoId)) {
      deeplinkFoundRef.current = true
      setDeeplinkFailed(false)
    }
  }, [initialVideoId, videos])

  // Save feed position to localStorage on slide change (skip when deep link
  // is active). localStorage rather than sessionStorage so this survives a
  // real app restart, not just tab lifetime.
  const currentVideoId = videos[activeIndex]?.id
  const feedStateTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    if (!currentVideoId || initialVideoId) return
    clearTimeout(feedStateTimer.current)
    feedStateTimer.current = setTimeout(() => {
      localStorage.setItem(FEED_STATE_KEY, JSON.stringify({
        videoId: currentVideoId,
        feedType,
        filterTag,
      }))
    }, 1000)
    return () => clearTimeout(feedStateTimer.current)
  }, [currentVideoId, feedType, filterTag, initialVideoId])

  // ── "Seen" tracking ──
  // Mark videos as seen once they become active, batched and flushed
  // periodically (not per-video) so scrolling doesn't hammer the cache with
  // writes. Used below as a fallback resume position when the exact saved
  // video is no longer in the loaded window (pruned, or content changed).
  const pendingSeenRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const video = videos[activeIndex]
    if (video) pendingSeenRef.current.add(video.id)
  }, [activeIndex, videos])

  useEffect(() => {
    const flush = () => {
      if (pendingSeenRef.current.size === 0) return
      const ids = [...pendingSeenRef.current]
      pendingSeenRef.current.clear()
      void markVideosSeen(ids)
    }
    const interval = setInterval(flush, SEEN_FLUSH_INTERVAL_MS)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', flush)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])

  // Look up which of the currently-loaded videos are already seen, for the
  // fallback resume position below. Re-fetched whenever the loaded window
  // or feed identity changes.
  const [seenIds, setSeenIds] = useState<Set<string> | null>(null)
  useEffect(() => {
    if (videos.length === 0) return
    let cancelled = false
    getSeenVideoIds(videos.map(v => v.id)).then((ids) => {
      if (!cancelled) setSeenIds(ids)
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos, feedType, filterTag])

  // Compute initial scroll target and scroll on mount
  const initialTargetIndex = useMemo(() => {
    if (initialVideoId) {
      const idx = videos.findIndex(v => v.id === initialVideoId)
      return idx >= 0 ? idx : null
    }
    const saved = (() => {
      try {
        const raw = localStorage.getItem(FEED_STATE_KEY)
        return raw ? JSON.parse(raw) : null
      } catch { return null }
    })()
    if (saved?.videoId && saved.feedType === feedType && saved.filterTag === filterTag) {
      const idx = videos.findIndex(v => v.id === saved.videoId)
      if (idx >= 0) return idx
    }
    // Fallback: the exact saved video isn't in the loaded window anymore —
    // resume at the first not-yet-seen video instead of starting from 0.
    if (saved?.feedType === feedType && saved?.filterTag === filterTag && seenIds) {
      const idx = videos.findIndex(v => !seenIds.has(v.id))
      if (idx > 0) return idx
    }
    return null
  }, [videos, initialVideoId, feedType, filterTag, seenIds])

  // Scroll to initial target on mount (deep link or session restore)
  useEffect(() => {
    if (initialScrollDoneRef.current) return
    if (videos.length === 0) return
    if (initialTargetIndex === null) return

    initialScrollDoneRef.current = true
    scrollToIndex(initialTargetIndex)
    setActiveIndex(initialTargetIndex)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos.length, initialTargetIndex])

  // Note: no scroll correction is needed when the feed grows. useFeedVideos
  // maintains a session-stable, append-only order — new videos (live or
  // backfilled) are always appended after what's already showing, so an
  // already-visible item's index never changes underneath the user.

  return {
    deeplinkFailed,
    deeplinkPending,
    activeVideoIdRef,
  }
}
