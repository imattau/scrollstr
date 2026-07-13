import React, { useEffect, useRef, useState, useCallback, useLayoutEffect, useMemo } from 'react'
import { Swiper, SwiperSlide } from 'swiper/react'
import { Virtual, Keyboard, Mousewheel } from 'swiper/modules'
import type { Swiper as SwiperType } from 'swiper'
import 'swiper/css'
import 'swiper/css/virtual'
import 'swiper/css/keyboard'
import 'swiper/css/mousewheel'
import { VideoFeedItem, VideoItemData } from './VideoFeedItem'
import { useNostr } from '../../app/providers'
import { useUserRelayUrls } from '../../nostr/relays'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../nostr/cache'
import { useMuteList } from '../../nostr/useMuteList'
import { subscribeToRelays } from '../../nostr/pool'
import { useFeedVideos } from './useFeedVideos'
import { useFeedPosition } from './useFeedPosition'
import { useFeedSubscriptions } from './useFeedSubscriptions'

import { useSearchParams } from 'react-router-dom'
import { ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, ArrowUp, Sparkles, RotateCw } from 'lucide-react'

interface VideoFeedProps {
  onActionTrigger: (actionType: string, videoId: string, creatorPubkey?: string, videoKind?: number) => void
  onVideoChange?: (video: VideoItemData) => void
  isMuted: boolean
}

export const VideoFeed = React.memo<VideoFeedProps>(({ onActionTrigger, onVideoChange, isMuted }) => {
  const { session } = useNostr()
  const [searchParams] = useSearchParams()
  const filterTag = searchParams.get('tag')
  const initialVideoId = searchParams.get('v')
  const feedType = searchParams.get('feed') || 'explore'

  const [activeIndex, setActiveIndex] = useState(0)
  const activeIndexRef = useRef(activeIndex)
  useEffect(() => { activeIndexRef.current = activeIndex }, [activeIndex])
  const [uiHidden, setUiHidden] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const relayUrls = useUserRelayUrls(session?.pubkey)

  const swiperRef = useRef<SwiperType | null>(null)

  // Destroy Swiper synchronously before React removes DOM nodes on unmount,
  // preventing "removeChild" errors caused by Swiper's virtual module
  // moving DOM nodes that React later tries to remove from their original parent.
  useLayoutEffect(() => {
    return () => {
      const swiper = swiperRef.current
      if (swiper && !swiper.destroyed) {
        swiper.destroy()
      }
    }
  }, [])

  // Reactively query the user's kind:3 contact list from Dexie cache
  const contactListEvents = useLiveQuery(
    () => session?.pubkey
      ? db.cachedEvents.where({ kind: 3, pubkey: session.pubkey }).toArray()
      : Promise.resolve([] as any[]),
    [session?.pubkey ?? '']
  ) ?? []

  const contactListEvent = contactListEvents.toSorted((a, b) => b.created_at - a.created_at)[0]?.event

  const followingPubkeys = useMemo(() => {
    if (!contactListEvent) return []
    return contactListEvent.tags.filter((t: any) => t[0] === 'p').map((t: any) => t[1])
  }, [contactListEvent])

  const { mutedPubkeys, mutedHashtags } = useMuteList(session?.pubkey)

  // Feed data: videos, filtering, sorting
  const { videos: rawVideos, feedKey, videosRef } = useFeedVideos({
    sessionPubkey: session?.pubkey,
    feedType,
    followingPubkeys,
    mutedPubkeys,
    mutedHashtags,
    filterTag,
    refreshKey,
  })

  // Stabilize videos array reference to prevent React/Swiper DOM conflicts
  const videos = useMemo(() => rawVideos, [rawVideos])

  // Track active video by ID instead of index so the playing video stays active
  // when new videos are prepended and indices shift.
  const activeVideoId = videos[activeIndex]?.id

  // Feed position: deep link, sessionStorage, Swiper position restoration
  const {
    swiperInitialSlide,
    deeplinkFailed,
    deeplinkPending,
    activeVideoIdRef,
    prevVideosLengthRef,
  } = useFeedPosition({
    initialVideoId,
    feedType,
    filterTag,
    videos,
    swiperRef,
    activeIndex,
    setActiveIndex,
  })

  // Subscriptions: relays, backfills, load-more
  const oldestCreatedAt = videos[videos.length - 1]?.createdAt
  useFeedSubscriptions({
    relayUrls,
    sessionPubkey: session?.pubkey,
    followingPubkeys,
    mutedPubkeys,
    activeIndex,
    videosLength: videos.length,
    oldestCreatedAt,
    refreshKey,
  })

  // Progressive comments & zaps subscription for videos near the viewport
  const lastSubscribedVideoIdsRef = useRef<string[]>([])
  useEffect(() => {
    if (videos.length === 0) return
    const activeVideo = videos[activeIndex]
    const nextVideo = videos[activeIndex + 1]
    if (!activeVideo) return

    const videoIdsToFetch = [activeVideo.id]
    if (nextVideo) {
      videoIdsToFetch.push(nextVideo.id)
    }

    const prev = lastSubscribedVideoIdsRef.current
    if (
      prev.length === videoIdsToFetch.length &&
      prev.every((id, i) => id === videoIdsToFetch[i])
    ) {
      return
    }
    lastSubscribedVideoIdsRef.current = videoIdsToFetch

    const unsub = subscribeToRelays(relayUrls, { kinds: [7, 16, 9735, 1111], '#e': videoIdsToFetch })

    return unsub
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, feedKey, relayUrls])

  // New-events counter
  const [newEventsCount, setNewEventsCount] = useState(0)
  const seenVideoIdsRef = useRef<Set<string>>(new Set())

  useLayoutEffect(() => {
    if (videos.length === 0) return

    if (seenVideoIdsRef.current.size === 0) {
      seenVideoIdsRef.current = new Set(videos.map(v => v.id))
      return
    }

    if (activeIndexRef.current <= 0) {
      seenVideoIdsRef.current = new Set(videos.map(v => v.id))
      setNewEventsCount(0)
      return
    }

    const unseen = videos.filter(v => !seenVideoIdsRef.current.has(v.id)).length
    if (unseen > 0) {
      setNewEventsCount(unseen)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos.length])

  const scrollToNewest = useCallback(() => {
    const currentVideos = videosRef.current
    if (currentVideos.length === 0) return
    swiperRef.current?.slideTo(0, 300)
    setActiveIndex(0)
    setNewEventsCount(0)
    seenVideoIdsRef.current = new Set(currentVideos.map(v => v.id))
  }, [videosRef])

  const handleSlideChange = useCallback((swiper: SwiperType) => {
    const idx = swiper.activeIndex
    setActiveIndex(idx)
    const video = videosRef.current[idx]
    if (onVideoChange && video) {
      onVideoChange(video)
    }
  }, [onVideoChange, videosRef])

  const handleActionClick = useCallback((action: string, videoId: string, videoKind?: number) => {
    const video = videosRef.current.find((v: VideoItemData) => v.id === videoId)
    onActionTrigger(action, videoId, video?.creator.pubkey, videoKind)
  }, [onActionTrigger, videosRef])

  if (videos.length === 0) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-[#09090b] text-[#a1a1aa] md:h-full px-8 text-center">
        {feedType === 'following' ? (
          <div className="space-y-2">
            <p className="text-[14px] font-semibold text-[#f7f7f8]">No videos from followed creators.</p>
            <p className="text-[12px] text-[#71717a]">Try following more accounts or switch to Explore feed!</p>
          </div>
        ) : (
          <p className="text-[14px]">Connecting to relays and loading videos...</p>
        )}
      </div>
    )
  }

  if (deeplinkPending) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-[#09090b] md:h-full">
        <div className="flex flex-col items-center gap-3">
          {deeplinkFailed ? (
            <>
              <p className="text-[14px] text-[#a1a1aa]">Video not found</p>
              <p className="text-[12px] text-[#71717a]">The video could not be loaded from relays.</p>
            </>
          ) : (
            <>
              <div className="size-8 animate-spin rounded-full border-2 border-[#27272a] border-t-[#8b5cf6]" />
              <p className="text-[14px] text-[#a1a1aa]">Finding video...</p>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-full relative overflow-hidden">
      <Swiper
        modules={[Virtual, Keyboard, Mousewheel]}
        direction="vertical"
        slidesPerView={1}
        virtual
        keyboard={{ enabled: true, onlyInViewport: false }}
        mousewheel
        speed={400}
        initialSlide={swiperInitialSlide}
        onSwiper={(s) => { swiperRef.current = s }}
        onSlideChange={handleSlideChange}
        observer
        observeParents
        observeSlideChildren
        className="h-full w-full"
      >
        {videos.map((video, index) => (
          <SwiperSlide key={video.id} virtualIndex={index}>
            <VideoFeedItem
              video={video}
              isActive={video.id === activeVideoId}
              isNearActive={Math.abs(index - activeIndex) <= 2}
              isMuted={isMuted}
              onActionClick={handleActionClick}
              uiHidden={uiHidden}
              onUiHiddenChange={setUiHidden}
            />
          </SwiperSlide>
        ))}
      </Swiper>

      {newEventsCount > 0 && activeIndex > 0 && !uiHidden && (
        <button
          onClick={scrollToNewest}
          className="new-events-pill"
          title={`${newEventsCount} new video${newEventsCount === 1 ? '' : 's'} — tap to go to newest`}
        >
          <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{newEventsCount} new</span>
          <ArrowUp className="w-3.5 h-3.5 flex-shrink-0" />
        </button>
      )}

      {/* Desktop navigation */}
      <div className={`hidden md:flex flex-col gap-2 absolute right-6 top-1/2 -translate-y-1/2 z-30 transition-opacity duration-300 ${uiHidden ? 'opacity-0 pointer-events-none' : ''}`}>
        <button
          onClick={() => {
            setRefreshKey(k => k + 1)
            setIsRefreshing(true)
            clearTimeout(refreshTimerRef.current)
            refreshTimerRef.current = setTimeout(() => setIsRefreshing(false), 1500)
          }}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-neutral-900/80 border border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-all duration-200 active:scale-95 shadow-lg cursor-pointer"
          title="Check for new content"
        >
          <RotateCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
        <button
          onClick={() => swiperRef.current?.slideTo(0, 300)}
          disabled={activeIndex === 0}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-neutral-900/80 border border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 disabled:opacity-30 disabled:pointer-events-none transition-all duration-200 active:scale-95 shadow-lg cursor-pointer"
          title="Jump to newest"
        >
          <ChevronsUp className="w-5 h-5" />
        </button>
        <button
          onClick={() => swiperRef.current?.slidePrev(300)}
          disabled={activeIndex === 0}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-neutral-900/80 border border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 disabled:opacity-30 disabled:pointer-events-none transition-all duration-200 active:scale-95 shadow-lg cursor-pointer"
          title="Previous Video"
        >
          <ChevronUp className="w-5 h-5" />
        </button>
        <button
          onClick={() => swiperRef.current?.slideNext(300)}
          disabled={activeIndex === videos.length - 1 || videos.length === 0}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-neutral-900/80 border border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 disabled:opacity-30 disabled:pointer-events-none transition-all duration-200 active:scale-95 shadow-lg cursor-pointer"
          title="Next Video"
        >
          <ChevronDown className="w-5 h-5" />
        </button>
        <button
          onClick={() => swiperRef.current?.slideTo(videos.length - 1, 300)}
          disabled={activeIndex === videos.length - 1 || videos.length === 0}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-neutral-900/80 border border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 disabled:opacity-30 disabled:pointer-events-none transition-all duration-200 active:scale-95 shadow-lg cursor-pointer"
          title="Jump to oldest"
        >
          <ChevronsDown className="w-5 h-5" />
        </button>
      </div>

      {/* Mobile navigation */}
      <div className={`md:hidden flex flex-col gap-2 absolute left-3 top-1/2 -translate-y-1/2 z-40 transition-opacity duration-300 ${uiHidden ? 'opacity-0 pointer-events-none' : ''}`}>
        <button
          onClick={() => {
            setRefreshKey(k => k + 1)
            setIsRefreshing(true)
            clearTimeout(refreshTimerRef.current)
            refreshTimerRef.current = setTimeout(() => setIsRefreshing(false), 1500)
          }}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-neutral-900/80 border border-neutral-800 text-neutral-400 transition-all duration-200 active:scale-95 shadow-lg cursor-pointer"
          title="Check for new content"
        >
          <RotateCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
        <button
          onClick={() => swiperRef.current?.slideTo(0, 300)}
          disabled={activeIndex === 0}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-neutral-900/80 border border-neutral-800 text-neutral-400 disabled:opacity-30 disabled:pointer-events-none transition-all duration-200 active:scale-95 shadow-lg cursor-pointer"
          title="Jump to newest"
        >
          <ChevronsUp className="w-4 h-4" />
        </button>
        <button
          onClick={() => swiperRef.current?.slideTo(videos.length - 1, 300)}
          disabled={activeIndex === videos.length - 1 || videos.length === 0}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-neutral-900/80 border border-neutral-800 text-neutral-400 disabled:opacity-30 disabled:pointer-events-none transition-all duration-200 active:scale-95 shadow-lg cursor-pointer"
          title="Jump to oldest"
        >
          <ChevronsDown className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
})
