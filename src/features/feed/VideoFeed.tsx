import React, { useEffect, useRef, useState, useMemo, useCallback, useLayoutEffect } from 'react'
import { use$ } from 'applesauce-react/hooks'
import { List, ListImperativeAPI } from 'react-window'
import { VideoFeedItem, VideoItemData } from './VideoFeedItem'
import { useNostr } from '../../app/providers'
import { parseVideoEvent } from '../../nostr/events/video'
import { subscribeToRelays, setActiveRelays, fetchFromRelays } from '../../nostr/pool'
import { getEventsQuery$ } from '../../nostr/rxNostr'
import { useUserRelayUrls } from '../../nostr/relays'
import { db, VideoShape, saveEventToCache } from '../../nostr/cache'
import { useLiveQuery } from 'dexie-react-hooks'
import { maybeResumeBackfill } from '../../nostr/cacheBackfill'

import { useSearchParams } from 'react-router-dom'
import { ChevronUp, ChevronDown, ArrowUp, Sparkles } from 'lucide-react'

const PAGE_SIZE = 50
const LOAD_MORE_THRESHOLD = 5
const LOCAL_PREVIEW_ID = 'local-preview-neon-mascot'
const MAX_FEED_ITEMS = 500

// Viewport constants
const WINDOW_BEFORE = 1
const WINDOW_AFTER = 2

const VideoFeedRow = React.memo(({ index, style, videos, isFetchingOlder, activeIndex, isMuted, handleActionClick }: any) => {
  if (index === videos.length) {
    return (
      <div
        style={{
          ...style,
          scrollSnapAlign: 'start',
          scrollSnapStop: 'always',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        className="flex h-dvh w-full items-center justify-center bg-[#09090b] text-[#a1a1aa]"
      >
        <p className="text-[14px]">Loading older videos...</p>
      </div>
    )
  }
  const video = videos[index]
  if (!video) return null

  const isNearActive = index >= activeIndex - WINDOW_BEFORE && index <= activeIndex + WINDOW_AFTER
  const isActive = index === activeIndex

  return (
    <div
      style={{
        ...style,
        scrollSnapAlign: 'start',
        scrollSnapStop: 'always',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      key={video.id}
    >
      <VideoFeedItem
        video={video}
        isActive={isActive}
        isNearActive={isNearActive}
        isMuted={isMuted}
        onActionClick={handleActionClick}
      />
    </div>
  )
})

interface VideoFeedProps {
  onActionTrigger: (actionType: string, videoId: string, creatorPubkey?: string, videoKind?: number) => void
  onVideoChange?: (video: VideoItemData) => void
  isMuted: boolean
}

export const VideoFeed: React.FC<VideoFeedProps> = ({ onActionTrigger, onVideoChange, isMuted }) => {
  const { session, eventStore } = useNostr()
  const [searchParams] = useSearchParams()
  const filterTag = searchParams.get('tag')
  const initialVideoId = searchParams.get('v')
  const feedType = searchParams.get('feed') || 'explore'

  const [activeIndex, setActiveIndex] = useState(0)
  const [isFetchingOlder, setIsFetchingOlder] = useState(false)
  const listRef = useRef<ListImperativeAPI>(null)
  const lastOlderFetchAtRef = useRef(0)
  const oldestLoadedCreatedAtRef = useRef<number | null>(null)
  const userMetadataSubscribedRef = useRef<string | null>(null)
  const currentVideoIdRef = useRef<string>('')
  const deepLinkFetchedRef = useRef(false)

  // New-events counter: tracks how many new items appeared before the current position
  const [newEventsCount, setNewEventsCount] = useState(0)
  // Snapshot of video IDs as the user last saw them from index 0
  const seenTopIdsRef = useRef<Set<string>>(new Set())
  // Whether the user has scrolled past the top
  const isAtTopRef = useRef(true)
  const relayUrls = useUserRelayUrls(eventStore, session?.pubkey)

  // Reactively subscribe to the user's kind:3 contact list so followingPubkeys
  // updates as soon as the event arrives from relays (fixes the stale-useMemo bug).
  const contactListEvent = use$(
    () => session?.pubkey
      ? getEventsQuery$({ kinds: [3], authors: [session.pubkey] })
      : getEventsQuery$({ kinds: [3], authors: [] }),
    [session?.pubkey ?? '']
  )?.[0]

  const followingPubkeys = useMemo(() => {
    if (!contactListEvent) return []
    return contactListEvent.tags.filter((t: any) => t[0] === 'p').map((t: any) => t[1])
  }, [contactListEvent])

  // Track whether we have loaded the user's initial metadata/relay lists from relays
  const [isMetadataLoaded, setIsMetadataLoaded] = useState(false)

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

  // 1. Fetch user's profile and relay list (kinds 0, 3, 10002) using bootstrap relays.
  // IMPORTANT: We intentionally do NOT include `relayUrls` in the deps here.
  // Doing so creates a chicken-and-egg loop: relayUrls depends on kind:10002 being
  // in the store, but kind:10002 can't be in the store until we fetch it. We always
  // bootstrap from well-known relays (including purplepag.es which indexes relay lists)
  // using a backward req so we actually retrieve historical/stored events.
  useEffect(() => {
    if (!session?.pubkey) {
      setIsMetadataLoaded(true)
      return
    }

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
      unsub()
      clearTimeout(timer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.pubkey])

  // 2a. Explore feed: fetch recent videos from all relays (no author filter)
  useEffect(() => {
    if (!isMetadataLoaded) return
    if (feedType === 'following') return // handled by 2b below
    console.log('[VideoFeed] Fetching explore feed...')
    const unsub = subscribeToRelays(relayUrls, {
      kinds: [21, 22, 34236],
      limit: 200,
      since: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30
    })
    return unsub
  }, [relayUrls, isMetadataLoaded, feedType])

  // 2b. Following feed: fetch videos authored by followed pubkeys.
  // Re-runs whenever followingPubkeys resolves (reactive kind:3 subscription).
  useEffect(() => {
    if (!isMetadataLoaded) return
    if (feedType !== 'following') return
    if (followingPubkeys.length === 0) return
    console.log(`[VideoFeed] Fetching following feed for ${followingPubkeys.length} authors...`)
    const unsub = subscribeToRelays(relayUrls, {
      kinds: [21, 22, 34236],
      authors: followingPubkeys,
      limit: 200,
      since: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30
    })
    return unsub
  }, [relayUrls, isMetadataLoaded, feedType, followingPubkeys])

  // 3. Query VideoShapes from Dexie and rank/sort them on the client side
  const dbShapes = useLiveQuery(async () => {
    const list = await db.videoShapes.toArray()
    return list
  }) || []

  const videos = useMemo(() => {
    let list = dbShapes.map((shape: VideoShape): VideoItemData => {
      return {
        id: shape.id,
        kind: 22,
        createdAt: shape.created_at,
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
        hasBoosted: shape.userState?.skipped || false,
        hasZapped: shape.userState?.zapped || false,
        music: 'Original Clip Audio',
        finalRankScore: shape.finalRankScore ?? 0,
        mediaStatus: shape.mediaStatus,
        width: shape.width,
        height: shape.height,
        duration: shape.duration,
        size: shape.size,
        mimeType: shape.mimeType
      }
    })

    // Filter out failed media
    list = list.filter((v: VideoItemData) => v.mediaStatus !== 'failed')

    if (filterTag) {
      list = list.filter((v: VideoItemData) =>
        v.hashtags?.some((t: string) => t.toLowerCase() === filterTag.toLowerCase())
      )
    }

    if (feedType === 'following' && session) {
      list = list.filter((v: VideoItemData) => followingPubkeys.includes(v.creator.pubkey))
    }

    // Sort by finalRankScore descending, then by created_at descending
    list.sort((a: VideoItemData, b: VideoItemData) => {
      if (a.id === LOCAL_PREVIEW_ID) return -1
      if (b.id === LOCAL_PREVIEW_ID) return 1
      
      const rankDiff = (b.finalRankScore ?? 0) - (a.finalRankScore ?? 0)
      if (Math.abs(rankDiff) > 0.001) return rankDiff

      return (b.createdAt ?? 0) - (a.createdAt ?? 0)
    })

    // Cap the rendered feed
    return list.slice(0, MAX_FEED_ITEMS)
  }, [dbShapes, filterTag, feedType, followingPubkeys, session])

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

    // Track current video and update activeIndex when list re-sorts
    if (videos.length > 0) {
      const currentVideoId = currentVideoIdRef.current
      if (currentVideoId) {
        const newIndex = videos.findIndex(v => v.id === currentVideoId)
        if (newIndex !== -1) {
          // Only update if the video position actually changed
          if (newIndex !== activeIndex) {
            setActiveIndex(newIndex)
            // Schedule scroll to maintain view of current video
            requestAnimationFrame(() => {
              listRef.current?.scrollToRow({ index: newIndex, align: 'auto', behavior: 'auto' })
            })
          }
          return
        }
      }
      // If no video is being tracked yet, use activeIndex
      currentVideoIdRef.current = videos[activeIndex]?.id ?? ''
    }

    // Keep activeIndex within bounds when videos list changes
    if (activeIndex >= videos.length) {
      setActiveIndex(Math.max(0, videos.length - 1))
    }
  }, [videos, activeIndex])

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
  useEffect(() => {
    if (videos.length === 0) return
    const activeVideo = videos[activeIndex]
    const nextVideo = videos[activeIndex + 1]
    if (!activeVideo) return

    const videoIdsToFetch = [activeVideo.id]
    if (nextVideo) {
      videoIdsToFetch.push(nextVideo.id)
    }

    const existingEvents = eventStore.getByFilters({ kinds: [7, 16, 9735, 1111], '#e': videoIdsToFetch })
    if (existingEvents.length > 0) {
      console.log(`Using cached reactions/comments for videos`, videoIdsToFetch)
      return
    }

    console.log(`Prefetching reactions/comments progressively near viewport:`, videoIdsToFetch)
    const unsub = subscribeToRelays(relayUrls, { kinds: [7, 16, 9735, 1111], '#e': videoIdsToFetch })

    return unsub
  }, [activeIndex, videos, relayUrls, eventStore])

  // Scroll to deep-linked video if present on load
  useEffect(() => {
    if (initialVideoId && videos.length > 0) {
      const idx = videos.findIndex((v: VideoItemData) => v.id === initialVideoId)
      if (idx !== -1) {
        setActiveIndex(idx)
        setTimeout(() => {
          listRef.current?.scrollToRow({ index: idx, align: 'auto', behavior: 'auto' })
        }, 100)
      } else if (!deepLinkFetchedRef.current) {
        deepLinkFetchedRef.current = true
        const existing = eventStore.getByFilters({ ids: [initialVideoId], kinds: [21, 22, 34236] })
        if (existing.length > 0) {
          existing.forEach(ev => saveEventToCache(ev))
        } else {
          fetchFromRelays(relayUrls, { ids: [initialVideoId], kinds: [21, 22, 34236] })
            .then(events => {
              events.forEach(event => {
                eventStore.add(event)
                saveEventToCache(event)
              })
            })
            .catch(err => console.error('[VideoFeed] Failed to fetch deep-linked video:', err))
        }
      }
    }
  }, [videos, initialVideoId, relayUrls, eventStore])

  // Track scroll position, snap, and run diagnostics
  const handleListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollOffset = e.currentTarget.scrollTop
    const containerHeight = e.currentTarget.clientHeight
    const newIndex = Math.round(scrollOffset / containerHeight)
    if (newIndex !== activeIndex && newIndex >= 0 && newIndex < videos.length) {
      setActiveIndex(newIndex)
      currentVideoIdRef.current = videos[newIndex]?.id ?? ''

      // Diagnostics log
      void (async () => {
        console.debug({
          cachedShapes: await db.videoShapes.count(),
          renderedFeedItems: videos.length,
          activeVideoSources: document.querySelectorAll("video[src]").length,
          mediaStatusCount: await db.mediaStatus.count()
        })
      })()
    }

    // Track whether user is at top
    isAtTopRef.current = newIndex === 0
    if (newIndex === 0) {
      // User scrolled back to the top — reset counter and update seen IDs
      setNewEventsCount(0)
      seenTopIdsRef.current = new Set(videos.map(v => v.id))
    }
  }, [activeIndex, videos])

  // Keyboard navigation for desktop view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT' ||
          activeEl.hasAttribute('contenteditable'))
      ) {
        return
      }

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        const nextIndex = activeIndex + 1
        if (nextIndex < videos.length) {
          listRef.current?.scrollToRow({ index: nextIndex, align: 'auto', behavior: 'auto' })
        }
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        const prevIndex = activeIndex - 1
        if (prevIndex >= 0) {
          listRef.current?.scrollToRow({ index: prevIndex, align: 'auto', behavior: 'auto' })
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeIndex, videos.length])

  // Propagate active video to parent
  useEffect(() => {
    if (onVideoChange && videos[activeIndex]) {
      onVideoChange(videos[activeIndex])
    }
  }, [activeIndex, videos, onVideoChange])

  // Detect newly arrived videos when user is not at index 0
  useLayoutEffect(() => {
    if (videos.length === 0) return

    // Initialise seen IDs on first render
    if (seenTopIdsRef.current.size === 0) {
      seenTopIdsRef.current = new Set(videos.map(v => v.id))
      return
    }

    if (isAtTopRef.current) {
      // Always keep seen set fresh when at top
      seenTopIdsRef.current = new Set(videos.map(v => v.id))
      return
    }

    // Count videos that weren't in the set when user was last at the top
    const unseen = videos.filter(v => !seenTopIdsRef.current.has(v.id)).length
    if (unseen > 0) {
      setNewEventsCount(unseen)
    }
  }, [videos])

  const handleScrollToTop = useCallback(() => {
    listRef.current?.scrollToRow({ index: 0, align: 'auto', behavior: 'smooth' })
    setActiveIndex(0)
    currentVideoIdRef.current = videos[0]?.id ?? ''
    isAtTopRef.current = true
    setNewEventsCount(0)
    seenTopIdsRef.current = new Set(videos.map(v => v.id))
  }, [videos])

  const handleActionClick = useCallback((action: string, videoId: string, videoKind?: number) => {
    const video = videos.find((v: VideoItemData) => v.id === videoId)
    onActionTrigger(action, videoId, video?.creator.pubkey, videoKind)
  }, [videos, onActionTrigger])

  const rowProps = useMemo(() => ({
    videos,
    isFetchingOlder,
    activeIndex,
    isMuted,
    handleActionClick,
  }), [videos, isFetchingOlder, activeIndex, isMuted, handleActionClick])

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
      <List
        listRef={listRef}
        rowCount={videos.length + (isFetchingOlder ? 1 : 0)}
        rowHeight="100%"
        className="feed-container"
        onScroll={handleListScroll}
        style={{ width: '100%', height: '100%' }}
        rowProps={rowProps}
        rowComponent={VideoFeedRow as any}
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
      <div className="hidden md:flex flex-col gap-3 absolute right-6 top-1/2 -translate-y-1/2 z-30">
        <button
          onClick={() => {
            if (activeIndex > 0 && activeIndex - 1 < videos.length) {
              listRef.current?.scrollToRow({ index: activeIndex - 1, align: 'auto', behavior: 'auto' })
            }
          }}
          disabled={activeIndex === 0}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-neutral-900/80 border border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 disabled:opacity-30 disabled:pointer-events-none transition-all duration-200 active:scale-95 shadow-lg cursor-pointer"
          title="Previous Video"
        >
          <ChevronUp className="w-5 h-5" />
        </button>
        <button
          onClick={() => {
            if (activeIndex < videos.length - 1 && activeIndex + 1 < videos.length) {
              listRef.current?.scrollToRow({ index: activeIndex + 1, align: 'auto', behavior: 'auto' })
            }
          }}
          disabled={activeIndex === videos.length - 1 || videos.length === 0}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-neutral-900/80 border border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 disabled:opacity-30 disabled:pointer-events-none transition-all duration-200 active:scale-95 shadow-lg cursor-pointer"
          title="Next Video"
        >
          <ChevronDown className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}
