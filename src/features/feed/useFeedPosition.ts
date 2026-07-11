import { useEffect, useMemo, useRef, useState } from 'react'
import type { VideoItemData } from './VideoFeedItem'

interface UseFeedPositionInput {
  initialVideoId: string | null
  feedType: string
  filterTag: string | null
  videos: VideoItemData[]
  swiperRef: React.MutableRefObject<any>
  activeIndex: number
  setActiveIndex: (index: number) => void
}

interface UseFeedPositionOutput {
  swiperInitialSlide: number
  deeplinkFailed: boolean
  deeplinkPending: boolean
  activeVideoIdRef: React.MutableRefObject<string | null>
  prevVideosLengthRef: React.MutableRefObject<number>
}

export function useFeedPosition(input: UseFeedPositionInput): UseFeedPositionOutput {
  const { initialVideoId, feedType, filterTag, videos, swiperRef, activeIndex, setActiveIndex } = input

  const [deeplinkFailed, setDeeplinkFailed] = useState(false)
  const deeplinkFoundRef = useRef(false)
  const activeVideoIdRef = useRef<string | null>(null)
  const prevVideosLengthRef = useRef(0)

  // Track the active video ID so we can restore position when new events arrive
  useEffect(() => {
    const video = videos[activeIndex]
    if (video) {
      activeVideoIdRef.current = video.id
    }
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

  // Restore saved feed position from sessionStorage
  const savedFeedState = useMemo(() => {
    try {
      const raw = sessionStorage.getItem('scrollstr-feed-state')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }, [])

  const swiperInitialSlide = useMemo(() => {
    if (initialVideoId) {
      const idx = videos.findIndex(v => v.id === initialVideoId)
      return idx >= 0 ? idx : 0
    }
    if (savedFeedState?.videoId) {
      const idx = videos.findIndex(v => v.id === savedFeedState.videoId)
      if (idx >= 0) return idx
    }
    return 0
  }, [initialVideoId, videos, savedFeedState])

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

  // Restore Swiper position when new videos are inserted at the front of the feed
  const videosRef = useRef(videos)
  useEffect(() => { videosRef.current = videos }, [videos])
  useEffect(() => {
    const swiper = swiperRef.current
    if (!swiper) return

    const prevLength = prevVideosLengthRef.current
    prevVideosLengthRef.current = videos.length

    if (videos.length <= prevLength) return
    if (initialVideoId) return

    const activeId = activeVideoIdRef.current
    if (!activeId) return

    const currentSlideVideo = videos[swiper.activeIndex]
    if (currentSlideVideo?.id === activeId) return

    const newIndex = videos.findIndex(v => v.id === activeId)
    if (newIndex >= 0) {
      requestAnimationFrame(() => {
        if (swiperRef.current && !swiperRef.current.destroyed) {
          swiperRef.current.slideTo(newIndex, 0)
        }
      })
    }
  }, [videos.length, initialVideoId])

  // Scroll to deep-linked video on load
  useEffect(() => {
    if (!initialVideoId || videos.length === 0 || !swiperRef.current) return
    const idx = videos.findIndex(v => v.id === initialVideoId)
    if (idx < 0) return
    swiperRef.current.slideTo(idx, 0)
    setActiveIndex(idx)
  }, [initialVideoId, videos.length])

  // Restore saved feed position on load (when no deep link)
  useEffect(() => {
    if (initialVideoId || videos.length === 0 || !swiperRef.current) return
    const saved = savedFeedState
    if (!saved?.videoId) return
    if (saved.feedType !== feedType) return
    if (saved.filterTag !== filterTag) return
    const idx = videos.findIndex(v => v.id === saved.videoId)
    if (idx < 0) return
    swiperRef.current.slideTo(idx, 0)
    setActiveIndex(idx)
  }, [videos.length, savedFeedState, initialVideoId, feedType, filterTag])

  return {
    swiperInitialSlide,
    deeplinkFailed,
    deeplinkPending,
    activeVideoIdRef,
    prevVideosLengthRef,
  }
}
