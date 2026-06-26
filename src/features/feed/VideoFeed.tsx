import React, { useEffect, useRef, useState, useMemo, useCallback, useLayoutEffect } from 'react'
import { Swiper, SwiperSlide } from 'swiper/react'
import { Virtual, Keyboard, Mousewheel } from 'swiper/modules'
import type { Swiper as SwiperType } from 'swiper'
import 'swiper/css'
import 'swiper/css/virtual'
import 'swiper/css/keyboard'
import 'swiper/css/mousewheel'
import { VideoFeedItem, VideoItemData } from './VideoFeedItem'
import { useNostr } from '../../app/providers'
import { subscribeToRelays, setActiveRelays } from '../../nostr/pool'
import { useUserRelayUrls } from '../../nostr/relays'
import { db, VideoShape } from '../../nostr/cache'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMuteList } from '../../nostr/useMuteList'
import { maybeResumeBackfill, maybeResumeProfileBackfill, maybeResumeFollowedVideoBackfill } from '../../nostr/cacheBackfill'

import { useSearchParams } from 'react-router-dom'
import { ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, ArrowDown, Sparkles } from 'lucide-react'
import { sortByInsertOrder } from './feedSort'

const PAGE_SIZE = 50
const LOAD_MORE_THRESHOLD = 5

interface VideoFeedProps {
  onActionTrigger: (actionType: string, videoId: string, creatorPubkey?: string, videoKind?: number) => void
  onVideoChange?: (video: VideoItemData) => void
  isMuted: boolean
}

export const VideoFeed: React.FC<VideoFeedProps> = ({ onActionTrigger, onVideoChange, isMuted }) => {
  const { session } = useNostr()
  const [searchParams] = useSearchParams()
  const filterTag = searchParams.get('tag')
  const initialVideoId = searchParams.get('v')
  const feedType = searchParams.get('feed') || 'explore'

  const [activeIndex, setActiveIndex] = useState(0)
  const activeIndexRef = useRef(activeIndex)
  useEffect(() => { activeIndexRef.current = activeIndex }, [activeIndex])
  const [isFetchingOlder, setIsFetchingOlder] = useState(false)
  const lastOlderFetchAtRef = useRef(0)
  const userMetadataSubscribedRef = useRef<string | null>(null)
  const relayUrls = useUserRelayUrls(session?.pubkey)

  const swiperRef = useRef<SwiperType | null>(null)
  const [newEventsCount, setNewEventsCount] = useState(0)
  const [uiHidden, setUiHidden] = useState(false)
  const endVideoIdsRef = useRef<Set<string>>(new Set())

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

  // Track whether we have loaded the user's initial metadata/relay lists from relays
  const [isMetadataLoaded, setIsMetadataLoaded] = useState(false)

  // Loading indicator for the feed subscription
  const [isFeedLoading, setIsFeedLoading] = useState(true)

  // Sync pool default relays whenever the user's relay list resolves.
  useEffect(() => {
    if (relayUrls.length > 0) {
      console.log('[VideoFeed] Updating active relays to user list:', relayUrls)
      setActiveRelays(relayUrls)
      void maybeResumeBackfill(relayUrls)
    }
  }, [relayUrls])

  // Profile backfill: pre-fetch kind:0 metadata and video events for
  // followed users so the Following feed is populated quickly.
  useEffect(() => {
    if (followingPubkeys.length > 0 && relayUrls.length > 0) {
      void maybeResumeProfileBackfill(relayUrls, followingPubkeys)
      maybeResumeFollowedVideoBackfill(relayUrls, followingPubkeys)
    }
  }, [followingPubkeys, relayUrls])

  // Bootstrap user metadata from cache + relays
  useEffect(() => {
    if (!session?.pubkey) {
      setIsMetadataLoaded(true)
      return
    }

    let cancelled = false

    Promise.all([
      db.cachedEvents.where({ kind: 0, pubkey: session.pubkey }).first(),
      db.cachedEvents.where({ kind: 3, pubkey: session.pubkey }).first(),
      db.cachedEvents.where({ kind: 10002, pubkey: session.pubkey }).first(),
    ]).then(([kind0, kind3, kind10002]) => {
      if (cancelled) return
      if (kind0 && kind3 && kind10002) {
        console.log(`[VideoFeed] User metadata found in cache, setting loaded immediately`)
        setIsMetadataLoaded(true)
      }
    })

    const bootstrapRelays = [
      'wss://purplepag.es',
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.snort.social',
    ]

    console.log(`[VideoFeed] Fetching user profile and relay list for ${session.pubkey} over bootstrap relays:`, bootstrapRelays)

    const unsub = subscribeToRelays(bootstrapRelays, { kinds: [0, 3, 10002], authors: [session.pubkey], limit: 3 })

    const timer = setTimeout(() => {
      console.log(`[VideoFeed] Metadata loaded (or timeout)`)
      setIsMetadataLoaded(true)
    }, 1500)

    return () => {
      cancelled = true
      unsub()
      clearTimeout(timer)
    }
  }, [session?.pubkey])

  // Feed subscription: fetch recent videos from all relays into the cache.
  useEffect(() => {
    if (relayUrls.length === 0) return
    console.log('[VideoFeed] Fetching videos...')
    setIsFeedLoading(true)
    const unsub = subscribeToRelays(relayUrls, {
      kinds: [1, 21, 22, 34236],
      since: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30
    })
    const timer = setTimeout(() => setIsFeedLoading(false), 2000)
    return () => {
      unsub()
      clearTimeout(timer)
    }
  }, [relayUrls])

  // Query all non-failed videos for Explore feed (reactive to Dexie changes)
  const _allShapes = useLiveQuery(async () => {
    try {
      return await db.videoShapes.where('mediaStatus').notEqual('failed').toArray()
    } catch (err) {
      console.error('[VideoFeed] Error in video query:', err)
      return []
    }
  }, [])
  const allShapes = useMemo(() => {
    const shapes = _allShapes ?? []
    if (mutedPubkeys.size === 0) return shapes
    return shapes.filter((s: VideoShape) => !mutedPubkeys.has(s.pubkey))
  }, [_allShapes, mutedPubkeys])

  // Query videos from followed pubkeys using the pubkey index (reactive to Dexie changes)
  const _followedShapes = useLiveQuery(async () => {
    if (!session || followingPubkeys.length === 0) return []
    try {
      return await db.videoShapes
        .where('pubkey').anyOf(followingPubkeys)
        .filter(shape => shape.mediaStatus !== 'failed')
        .toArray()
    } catch (err) {
      console.error('[VideoFeed] Error in following video query:', err)
      return []
    }
  }, [session, followingPubkeys])
  const followedShapes = useMemo(() => {
    const shapes = _followedShapes ?? []
    if (mutedPubkeys.size === 0) return shapes
    return shapes.filter((s: VideoShape) => !mutedPubkeys.has(s.pubkey))
  }, [_followedShapes, mutedPubkeys])

  const mapShapeToVideoItem = (shape: VideoShape): VideoItemData => ({
    id: shape.id,
    kind: 22,
    createdAt: shape.created_at,
    firstSeen: shape.firstSeen,
    insertOrder: shape.insertOrder,
    title: shape.title ?? '',
    description: shape.summary ?? '',
    url: shape.videoUrl,
    poster: shape.thumbnailUrl,
    creator: {
      pubkey: shape.pubkey,
      name: shape.authorName || shape.pubkey.slice(0, 8),
      picture: shape.authorPicture
    },
    hashtags: shape.hashtags || [],
    likesCount: shape.reactionCount || 0,
    commentsCount: shape.replyCount || 0,
    boostsCount: shape.repostCount || 0,
    zapsCount: shape.zapCount || 0,
    hasLiked: shape.userState?.liked || false,
    hasBoosted: shape.userState?.boosted || false,
    hasZapped: shape.userState?.zapped || false,
    music: 'Original Clip Audio',
    mediaStatus: shape.mediaStatus,
    contentWarning: shape.contentWarning,
    width: shape.width,
    height: shape.height,
    duration: shape.duration,
    size: shape.size,
    mimeType: shape.mimeType
  })

  const videos = useMemo(() => {
    const source = feedType === 'following' && session ? followedShapes : allShapes
    let list = source.map(mapShapeToVideoItem)

    if (filterTag) {
      list = list.filter((v: VideoItemData) =>
        v.hashtags?.some((t: string) => t.toLowerCase() === filterTag.toLowerCase())
      )
    }

    if (mutedHashtags.size > 0) {
      list = list.filter((v: VideoItemData) =>
        !v.hashtags?.some((t: string) => mutedHashtags.has(t.toLowerCase()))
      )
    }

    return [...list].sort(sortByInsertOrder)
  }, [allShapes, followedShapes, feedType, session, filterTag, mutedHashtags])

  const videosRef = useRef(videos)
  useEffect(() => { videosRef.current = videos }, [videos])

  const deeplinkPending = !!initialVideoId && !videos.some(v => v.id === initialVideoId)

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

  // Feed identity string for effect dependencies (only changes when IDs/order changes)
  const feedKey = useMemo(
    () => videos.map((v) => v.id).join(','),
    [videos]
  )

  // Load more older content when approaching the beginning of the feed (index 0).
  // Since all content uses insertOrder = Date.now() on first discovery, older
  // backfilled events also append at the end of the list.
  const oldestCreatedAt = videos[0]?.createdAt
  useEffect(() => {
    if (videos.length === 0) return
    if (activeIndex > LOAD_MORE_THRESHOLD) return
    if (isFetchingOlder) return

    if (!oldestCreatedAt) return

    const now = Date.now()
    if (now - lastOlderFetchAtRef.current < 1500) return
    lastOlderFetchAtRef.current = now
    setIsFetchingOlder(true)

    console.log(`Loading older videos before ${oldestCreatedAt}...`)
    const unsub = subscribeToRelays(relayUrls, {
      kinds: [1, 21, 22, 34236],
      limit: PAGE_SIZE,
      until: oldestCreatedAt - 1,
    })
    const doneTimer = setTimeout(() => setIsFetchingOlder(false), 3000)

    return () => {
      unsub()
      clearTimeout(doneTimer)
    }
  }, [activeIndex, isFetchingOlder, videos.length, oldestCreatedAt, relayUrls])

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

  // Save feed position to sessionStorage on slide change (skip when deep link is active)
  const currentVideoId = videos[activeIndex]?.id
  useEffect(() => {
    if (!currentVideoId || initialVideoId) return
    sessionStorage.setItem('scrollstr-feed-state', JSON.stringify({
      videoId: currentVideoId,
      feedType,
      filterTag,
    }))
  }, [currentVideoId, feedType, filterTag, initialVideoId])

  // Scroll to deep-linked video on load
  useEffect(() => {
    if (!initialVideoId || videos.length === 0 || !swiperRef.current) return
    const idx = videosRef.current.findIndex(v => v.id === initialVideoId)
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
    const idx = videosRef.current.findIndex(v => v.id === saved.videoId)
    if (idx < 0) return
    swiperRef.current.slideTo(idx, 0)
    setActiveIndex(idx)
  }, [videos.length, savedFeedState, initialVideoId, feedType, filterTag])

  // Propagate active video to parent
  const handleSlideChange = useCallback((swiper: SwiperType) => {
    const idx = swiper.activeIndex
    setActiveIndex(idx)
    const video = videosRef.current[idx]
    if (onVideoChange && video) {
      onVideoChange(video)
    }
  }, [onVideoChange])

  // New-events counter: tracks how many new items appeared before the current end position.
  // With ascending sort, new videos append at the end (highest insertOrder).
  useLayoutEffect(() => {
    if (videos.length === 0) return

    // Initialise seen IDs on first render
    if (endVideoIdsRef.current.size === 0) {
      endVideoIdsRef.current = new Set(videos.map(v => v.id))
      return
    }

    // Near the end → reset seen set
    if (activeIndexRef.current >= videos.length - 1) {
      endVideoIdsRef.current = new Set(videos.map(v => v.id))
      setNewEventsCount(0)
      return
    }

    // Count videos that aren't in the seen set
    const unseen = videos.filter(v => !endVideoIdsRef.current.has(v.id)).length
    if (unseen > 0) {
      setNewEventsCount(unseen)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos.length])

  const scrollToNewest = useCallback(() => {
    const currentVideos = videosRef.current
    if (currentVideos.length === 0) return
    swiperRef.current?.slideTo(currentVideos.length - 1, 300)
    setActiveIndex(currentVideos.length - 1)
    setNewEventsCount(0)
    endVideoIdsRef.current = new Set(currentVideos.map(v => v.id))
  }, [])

  const handleActionClick = useCallback((action: string, videoId: string, videoKind?: number) => {
    const video = videosRef.current.find((v: VideoItemData) => v.id === videoId)
    onActionTrigger(action, videoId, video?.creator.pubkey, videoKind)
  }, [onActionTrigger])

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
          <div className="size-8 animate-spin rounded-full border-2 border-[#27272a] border-t-[#8b5cf6]" />
          <p className="text-[14px] text-[#a1a1aa]">Finding video...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-full relative overflow-hidden">
      {isFeedLoading && <div className="feed-loading-bar" />}
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
        observeSlideChildren
        className="h-full w-full"
      >
        {videos.map((video, index) => (
          <SwiperSlide key={video.id} virtualIndex={index}>
            <VideoFeedItem
              video={video}
              isActive={index === activeIndex}
              isNearActive={Math.abs(index - activeIndex) <= 2}
              isMuted={isMuted}
              onActionClick={handleActionClick}
              uiHidden={uiHidden}
              onUiHiddenChange={setUiHidden}
            />
          </SwiperSlide>
        ))}
      </Swiper>

      {/* New events pill — shown at bottom when user has scrolled away from end and new videos arrived */}
      {newEventsCount > 0 && activeIndex < videos.length - 1 && (
        <button
          onClick={scrollToNewest}
          className="new-events-pill"
          title={`${newEventsCount} new video${newEventsCount === 1 ? '' : 's'} — tap to go to newest`}
        >
          <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{newEventsCount} new</span>
          <ArrowDown className="w-3.5 h-3.5 flex-shrink-0" />
        </button>
      )}

      {/* Floating navigation buttons for desktop */}
      <div className="hidden md:flex flex-col gap-2 absolute right-6 top-1/2 -translate-y-1/2 z-30">
        <button
          onClick={() => swiperRef.current?.slideTo(0, 300)}
          disabled={activeIndex === 0}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-neutral-900/80 border border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 disabled:opacity-30 disabled:pointer-events-none transition-all duration-200 active:scale-95 shadow-lg cursor-pointer"
          title="Jump to oldest"
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
          title="Jump to newest"
        >
          <ChevronsDown className="w-5 h-5" />
        </button>
      </div>

      {/* Mobile jump buttons */}
      <div className={`md:hidden flex flex-col gap-2 absolute left-3 top-1/2 -translate-y-1/2 z-40 transition-opacity duration-300 ${uiHidden ? 'opacity-0 pointer-events-none' : ''}`}>
        <button
          onClick={() => swiperRef.current?.slideTo(0, 300)}
          disabled={activeIndex === 0}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-neutral-900/80 border border-neutral-800 text-neutral-400 disabled:opacity-30 disabled:pointer-events-none transition-all duration-200 active:scale-95 shadow-lg cursor-pointer"
          title="Jump to oldest"
        >
          <ChevronsUp className="w-4 h-4" />
        </button>
        <button
          onClick={() => swiperRef.current?.slideTo(videos.length - 1, 300)}
          disabled={activeIndex === videos.length - 1 || videos.length === 0}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-neutral-900/80 border border-neutral-800 text-neutral-400 disabled:opacity-30 disabled:pointer-events-none transition-all duration-200 active:scale-95 shadow-lg cursor-pointer"
          title="Jump to newest"
        >
          <ChevronsDown className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
