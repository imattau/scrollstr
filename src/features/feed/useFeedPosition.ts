import { useEffect, useMemo, useRef, useState } from 'react'
import type { VideoItemData } from './VideoFeedItem'

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

  // Save feed position to sessionStorage on slide change (skip when deep link is active)
  const currentVideoId = videos[activeIndex]?.id
  const feedStateTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    if (!currentVideoId || initialVideoId) return
    clearTimeout(feedStateTimer.current)
    feedStateTimer.current = setTimeout(() => {
      sessionStorage.setItem('scrollstr-feed-state', JSON.stringify({
        videoId: currentVideoId,
        feedType,
        filterTag,
      }))
    }, 1000)
    return () => clearTimeout(feedStateTimer.current)
  }, [currentVideoId, feedType, filterTag, initialVideoId])

  // Compute initial scroll target and scroll on mount
  const initialTargetIndex = useMemo(() => {
    if (initialVideoId) {
      const idx = videos.findIndex(v => v.id === initialVideoId)
      return idx >= 0 ? idx : null
    }
    const saved = (() => {
      try {
        const raw = sessionStorage.getItem('scrollstr-feed-state')
        return raw ? JSON.parse(raw) : null
      } catch { return null }
    })()
    if (saved?.videoId && saved.feedType === feedType && saved.filterTag === filterTag) {
      const idx = videos.findIndex(v => v.id === saved.videoId)
      return idx >= 0 ? idx : null
    }
    return null
  }, [videos, initialVideoId, feedType, filterTag])

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

  // Restore position when new videos are inserted at the front
  const prevVideosLengthRef = useRef(0)
  useEffect(() => {
    const prevLength = prevVideosLengthRef.current
    prevVideosLengthRef.current = videos.length

    if (videos.length <= prevLength) return
    if (initialVideoId) return
    if (prevLength === 0) return // Skip initial render

    const activeId = activeVideoIdRef.current
    if (!activeId) return

    const currentIdx = videos.findIndex(v => v.id === activeId)
    if (currentIdx < 0) return

    // Check if we're still viewing the same video (by checking DOM scroll position)
    const vp = getMediaStackViewport()
    if (!vp) return
    const visibleIndex = Math.round(vp.scrollTop / vp.clientHeight)
    const visibleVideo = videos[visibleIndex]
    if (visibleVideo?.id === activeId) return

    scrollToIndex(currentIdx)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos.length, initialVideoId])

  return {
    deeplinkFailed,
    deeplinkPending,
    activeVideoIdRef,
  }
}
