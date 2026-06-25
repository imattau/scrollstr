import React, { useEffect, useRef, useState, useMemo, useCallback, useLayoutEffect } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { List, type ListImperativeAPI, type RowComponentProps } from 'react-window'
import { VideoFeedItem, VideoItemData } from './VideoFeedItem'
import { useNostr } from '../../app/providers'
import { subscribeToRelays, setActiveRelays } from '../../nostr/pool'
import { useUserRelayUrls } from '../../nostr/relays'
import { db, VideoShape } from '../../nostr/cache'
import { useLiveQuery } from 'dexie-react-hooks'
import { maybeResumeBackfill, maybeResumeProfileBackfill, maybeResumeFollowedVideoBackfill } from '../../nostr/cacheBackfill'

import { useSearchParams } from 'react-router-dom'
import { ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, ArrowUp, Sparkles } from 'lucide-react'
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
  const oldestLoadedCreatedAtRef = useRef<number | null>(null)
  const userMetadataSubscribedRef = useRef<string | null>(null)
  const currentVideoIdRef = useRef<string>('')
  const deepLinkJumpedRef = useRef(false)
  const lastDeepLinkVideoIdRef = useRef<string | null>(null)

  const listRef = useRef<ListImperativeAPI | null>(null)
  const [listHeight, setListHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : 800
  )
  const scrollStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isProgrammaticScrollRef = useRef(false)

  useEffect(() => {
    return () => {
      if (scrollStopTimerRef.current) clearTimeout(scrollStopTimerRef.current)
    }
  }, [])

  // New-events counter: tracks how many new items appeared before the current position
  const [newEventsCount, setNewEventsCount] = useState(0)
  // Snapshot of video IDs as the user last saw them from index 0
  const topVideoIdsRef = useRef<Set<string>>(new Set())
  const relayUrls = useUserRelayUrls(session?.pubkey)

  // Reactively query the user's kind:3 contact list from Dexie cache
  const contactListEvents = useLiveQuery(
    () => session?.pubkey
      ? db.cachedEvents.where({ kind: 3, pubkey: session.pubkey }).toArray()
      : Promise.resolve([] as any[]),
    [session?.pubkey ?? '']
  ) ?? []
  const contactListEvent = contactListEvents[contactListEvents.length - 1]?.event

  const followingPubkeys = useMemo(() => {
    if (!contactListEvent) return []
    return contactListEvent.tags.filter((t: any) => t[0] === 'p').map((t: any) => t[1])
  }, [contactListEvent])

  // Track whether we have loaded the user's initial metadata/relay lists from relays
  const [isMetadataLoaded, setIsMetadataLoaded] = useState(false)

  // Loading indicator for the feed subscription
  const [isFeedLoading, setIsFeedLoading] = useState(true)

  // Sync pool default relays whenever the user's relay list resolves.
  // This ensures ALL subscriptions (not just those with explicit { relays }) use
  // the user's actual relay list once kind:10002 has been fetched.
  useEffect(() => {
    if (relayUrls.length > 0) {
      console.log('[VideoFeed] Updating active relays to user list:', relayUrls)
      setActiveRelays(relayUrls)

      // Resume backfill with the user's own relay set.
      // maybeResumeBackfill is a no-op if the cache is already full or a backfill is running.
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

  // 1. Fetch user's profile and relay list (kinds 0, 3, 10002) using bootstrap relays.
  // IMPORTANT: We intentionally do NOT include `relayUrls` in the deps here.
  // Doing so creates a chicken-and-egg loop: relayUrls depends on kind:10002 being
  // in the store, but kind:10002 can't be in the store until we fetch it. We always
  // bootstrap from well-known relays (including purplepag.es which indexes relay lists)
  // using a backward req so we actually retrieve historical/stored events.
  //
  // Cache-first: check Dexie for existing metadata so returning users see content
  // immediately without waiting for relay responses or the 1.5s timeout.
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
  // Both explore and following views render from the same cache (filtered locally).
  // Starts immediately with fallback relays; metadata loading happens independently.
  useEffect(() => {
    if (relayUrls.length === 0) return
    console.log('[VideoFeed] Fetching videos...')
    setIsFeedLoading(true)
    const unsub = subscribeToRelays(relayUrls, {
      kinds: [21, 22, 34236],
      since: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30
    })
    const timer = setTimeout(() => setIsFeedLoading(false), 2000)
    return () => {
      unsub()
      clearTimeout(timer)
    }
  }, [relayUrls])

  const handleListResize = useCallback(({ height }: { height: number }) => {
    setListHeight(height)
  }, [])

  // Query all non-failed videos for Explore feed (reactive to Dexie changes)
  const _allShapes = useLiveQuery(async () => {
    try {
      return await db.videoShapes.where('mediaStatus').notEqual('failed').toArray()
    } catch (err) {
      console.error('[VideoFeed] Error in video query:', err)
      return []
    }
  }, [])
  const allShapes = useMemo(() => _allShapes ?? [], [_allShapes])

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
  const followedShapes = useMemo(() => _followedShapes ?? [], [_followedShapes])

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

    return [...list].sort(sortByInsertOrder)
  }, [allShapes, followedShapes, feedType, session, filterTag])

  const videosRef = useRef(videos)
  useEffect(() => { videosRef.current = videos }, [videos])

  const feedKey = useMemo(
    () => videos.map((v) => v.id).join(','),
    [videos]
  )

  // Guard ref: tracks the last known video ID order so downstream effects can
  // short-circuit when only metadata changed (preventing cascading re-renders
  // from reaching VideoPlayer). Written only inside effect callbacks.
  const lastFeedIdsRef = useRef<string[]>([])

  useEffect(() => {
    // Skip processing when the feed content (IDs + order) hasn't changed
    const prevIds = lastFeedIdsRef.current
    const currentIds = videos.map((v) => v.id)
    let feedChanged = currentIds.length !== prevIds.length
    if (!feedChanged) {
      for (let i = 0; i < currentIds.length; i++) {
        if (currentIds[i] !== prevIds[i]) {
          feedChanged = true
          break
        }
      }
    }
    if (!feedChanged) return
    lastFeedIdsRef.current = currentIds

    oldestLoadedCreatedAtRef.current = videos.length > 0 ? videos[videos.length - 1]?.createdAt ?? null : null

    // Maintain feed position across list changes. When at the top, stay at the
    // top so new content appears without jarring scroll adjustments. When scrolled
    // down, use the current video ID to find the same video at its new position.
    if (videos.length > 0) {
      if (activeIndexRef.current === 0) {
        if (activeIndex !== 0) {
          setActiveIndex(0)
        }
        currentVideoIdRef.current = videos[0]?.id ?? ''
        return
      }
      if (currentVideoIdRef.current) {
        const idx = videos.findIndex(v => v.id === currentVideoIdRef.current)
        if (idx !== -1 && idx !== activeIndex) {
          setActiveIndex(idx)
          isProgrammaticScrollRef.current = true
          listRef.current?.scrollToRow({ index: idx, align: 'start', behavior: 'auto' })
          return
        }
      }
      currentVideoIdRef.current = videos[Math.min(activeIndex, videos.length - 1)]?.id ?? ''
    }

    // Keep activeIndex within bounds when videos list changes
    if (activeIndex >= videos.length) {
      setActiveIndex(Math.max(0, videos.length - 1))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedKey, activeIndex])

  useEffect(() => {
    if (videos.length === 0) return
    if (activeIndex < videos.length - LOAD_MORE_THRESHOLD) return
    if (isFetchingOlder) return

    const oldestCreatedAt = oldestLoadedCreatedAtRef.current
    if (!oldestCreatedAt) return

    const now = Date.now()
    if (now - lastOlderFetchAtRef.current < 1500) return
    lastOlderFetchAtRef.current = now
    setIsFetchingOlder(true)

    console.log(`Loading older videos before ${oldestCreatedAt}...`)
    const unsub = subscribeToRelays(relayUrls, {
      kinds: [21, 22, 34236],
      limit: PAGE_SIZE,
      until: oldestCreatedAt - 1,
    })
    // Mark fetch done after a short delay to allow events to arrive
    const doneTimer = setTimeout(() => setIsFetchingOlder(false), 3000)

    return () => {
      unsub()
      clearTimeout(doneTimer)
    }
  }, [activeIndex, isFetchingOlder, videos.length, relayUrls])

  // Progressive comments & zaps subscription logic near viewport
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

    // Skip re-subscription if the video IDs haven't changed (avoids rapid
    // subscribe/unsubscribe cycles on every scroll event).
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

  // Scroll to deep-linked video if present on load
  useEffect(() => {
    if (!initialVideoId || videos.length === 0) return

    // Reset jump flag when the target video changes (e.g. navigating from one
    // `?v=X` to `?v=Y` without the feed component remounting).
    if (initialVideoId !== lastDeepLinkVideoIdRef.current) {
      deepLinkJumpedRef.current = false
    }
    if (deepLinkJumpedRef.current) return

    const idx = videos.findIndex(v => v.id === initialVideoId)
    if (idx === -1) return
    deepLinkJumpedRef.current = true
    lastDeepLinkVideoIdRef.current = initialVideoId
    setActiveIndex(idx)
    currentVideoIdRef.current = initialVideoId ?? ''
    isProgrammaticScrollRef.current = true
    listRef.current?.scrollToRow({ index: idx, align: 'start', behavior: 'auto' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialVideoId, feedKey])

  // Track scroll position, with debounced snap to nearest item
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (isProgrammaticScrollRef.current) {
      isProgrammaticScrollRef.current = false
      return
    }

    const scrollOffset = e.currentTarget.scrollTop
    const currentVideos = videosRef.current
    if (currentVideos.length === 0 || listHeight <= 0) return

    const newIndex = Math.round(scrollOffset / listHeight)
    const clampedIndex = Math.max(0, Math.min(newIndex, currentVideos.length - 1))

    if (clampedIndex !== activeIndexRef.current) {
      setActiveIndex(clampedIndex)
      currentVideoIdRef.current = currentVideos[clampedIndex]?.id ?? ''
    }

    if (clampedIndex === 0) {
      setNewEventsCount(0)
      topVideoIdsRef.current = new Set(currentVideos.map(v => v.id))
    }

    // Debounced snap to nearest item after scrolling stops
    if (scrollStopTimerRef.current) clearTimeout(scrollStopTimerRef.current)
    scrollStopTimerRef.current = setTimeout(() => {
      const snapIndex = Math.round(scrollOffset / listHeight)
      if (snapIndex >= 0 && snapIndex < currentVideos.length) {
        isProgrammaticScrollRef.current = true
        listRef.current?.scrollToRow({ index: snapIndex, align: 'start', behavior: 'auto' })
      }
    }, 150)
  }, [listHeight])

  // Keyboard navigation for desktop view — react-hotkeys-hook
  const scrollToIndex = useCallback((index: number) => {
    isProgrammaticScrollRef.current = true
    listRef.current?.scrollToRow({ index, align: 'start', behavior: 'smooth' })
  }, [])

  useHotkeys('j,down', (e) => {
    e.preventDefault()
    const nextIndex = activeIndex + 1
    if (nextIndex < videos.length) {
      scrollToIndex(nextIndex)
    }
  }, { enableOnFormTags: false }, [activeIndex, videos.length, scrollToIndex])

  useHotkeys('k,up', (e) => {
    e.preventDefault()
    const prevIndex = activeIndex - 1
    if (prevIndex >= 0) {
      scrollToIndex(prevIndex)
    }
  }, { enableOnFormTags: false }, [activeIndex, videos.length, scrollToIndex])

  // Propagate active video to parent — skip during feed reorder so the comment
  // panel doesn't flash the wrong video's comments while the index corrects.
  useEffect(() => {
    const video = videos[activeIndex]
    if (onVideoChange && video) {
      const trackedId = currentVideoIdRef.current
      if (trackedId && video.id !== trackedId) return
      onVideoChange(video)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, feedKey, onVideoChange])

  // Detect newly arrived videos when user is not at index 0
  useLayoutEffect(() => {
    if (videos.length === 0) return

    // Initialise seen IDs on first render
    if (topVideoIdsRef.current.size === 0) {
      topVideoIdsRef.current = new Set(videos.map(v => v.id))
      return
    }

    if (activeIndexRef.current === 0) {
      // Always keep seen set fresh when at top
      topVideoIdsRef.current = new Set(videos.map(v => v.id))
      return
    }

    // Count videos that weren't in the set when user was last at the top
    const unseen = videos.filter(v => !topVideoIdsRef.current.has(v.id)).length
    if (unseen > 0) {
      setNewEventsCount(unseen)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedKey])

  const handleScrollToTop = useCallback(() => {
    const currentVideos = videosRef.current
    if (currentVideos.length === 0) return
    isProgrammaticScrollRef.current = true
    listRef.current?.scrollToRow({ index: 0, align: 'start', behavior: 'smooth' })
    setActiveIndex(0)
    currentVideoIdRef.current = currentVideos[0]?.id ?? ''
    setNewEventsCount(0)
    topVideoIdsRef.current = new Set(currentVideos.map(v => v.id))
  }, [])

  const handleScrollToBottom = useCallback(() => {
    const currentVideos = videosRef.current
    const lastIndex = currentVideos.length - 1
    if (lastIndex < 0) return
    isProgrammaticScrollRef.current = true
    listRef.current?.scrollToRow({ index: lastIndex, align: 'start', behavior: 'smooth' })
    setActiveIndex(lastIndex)
    currentVideoIdRef.current = currentVideos[lastIndex]?.id ?? ''
    oldestLoadedCreatedAtRef.current = currentVideos[lastIndex]?.createdAt ?? null
  }, [])

  const handleActionClick = useCallback((action: string, videoId: string, videoKind?: number) => {
    const video = videosRef.current.find((v: VideoItemData) => v.id === videoId)
    onActionTrigger(action, videoId, video?.creator.pubkey, videoKind)
  }, [onActionTrigger])

  const Row = useCallback(({ index, style }: RowComponentProps) => {
    if (isFetchingOlder && index === videos.length) {
      return (
        <div style={style} className="flex h-full w-full items-center justify-center bg-[#09090b] text-[#a1a1aa]">
          <p className="text-[14px]">Loading older videos...</p>
        </div>
      )
    }
    const video = videos[index]
    if (!video) return null
    return (
      <div style={style}>
        <VideoFeedItem
          video={video}
          isActive={index === activeIndex}
          isNearActive={Math.abs(index - activeIndex) <= 2}
          isMuted={isMuted}
          onActionClick={handleActionClick}
        />
      </div>
    )
  }, [videos, activeIndex, isMuted, handleActionClick, isFetchingOlder])

  const itemCount = isFetchingOlder ? videos.length + 1 : videos.length

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

  return (
    <div className="w-full h-full relative overflow-hidden">
      {isFeedLoading && <div className="feed-loading-bar" />}
      <List
        listRef={listRef}
        style={{ height: '100%', scrollbarWidth: 'none' } as React.CSSProperties}
        rowHeight={listHeight}
        rowCount={itemCount}
        rowComponent={Row}
        rowProps={{}}
        onScroll={handleScroll}
        onResize={handleListResize}
        overscanCount={3}
        defaultHeight={listHeight}
      />

      {/* New events pill — shown when user has scrolled past index 0 and new videos arrived */}
      {newEventsCount > 0 && activeIndex > 0 && (
        <button
          onClick={handleScrollToTop}
          className="new-events-pill"
          title={`${newEventsCount} new video${newEventsCount === 1 ? '' : 's'} — tap to go to the top`}
        >
          <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{newEventsCount} new</span>
          <ArrowUp className="w-3.5 h-3.5 flex-shrink-0" />
        </button>
      )}

      {/* Floating navigation buttons for desktop */}
      <div className="hidden md:flex flex-col gap-2 absolute right-6 top-1/2 -translate-y-1/2 z-30">
        <button
          onClick={handleScrollToTop}
          disabled={activeIndex === 0}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-neutral-900/80 border border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 disabled:opacity-30 disabled:pointer-events-none transition-all duration-200 active:scale-95 shadow-lg cursor-pointer"
          title="Jump to top"
        >
          <ChevronsUp className="w-5 h-5" />
        </button>
        <button
          onClick={() => scrollToIndex(activeIndex - 1)}
          disabled={activeIndex === 0}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-neutral-900/80 border border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 disabled:opacity-30 disabled:pointer-events-none transition-all duration-200 active:scale-95 shadow-lg cursor-pointer"
          title="Previous Video"
        >
          <ChevronUp className="w-5 h-5" />
        </button>
        <button
          onClick={() => scrollToIndex(activeIndex + 1)}
          disabled={activeIndex === videos.length - 1 || videos.length === 0}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-neutral-900/80 border border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 disabled:opacity-30 disabled:pointer-events-none transition-all duration-200 active:scale-95 shadow-lg cursor-pointer"
          title="Next Video"
        >
          <ChevronDown className="w-5 h-5" />
        </button>
        <button
          onClick={handleScrollToBottom}
          disabled={activeIndex === videos.length - 1 || videos.length === 0}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-neutral-900/80 border border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 disabled:opacity-30 disabled:pointer-events-none transition-all duration-200 active:scale-95 shadow-lg cursor-pointer"
          title="Jump to bottom"
        >
          <ChevronsDown className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}
