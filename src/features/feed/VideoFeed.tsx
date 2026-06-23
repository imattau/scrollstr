import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { List, ListImperativeAPI } from 'react-window'
import { VideoFeedItem, VideoItemData } from './VideoFeedItem'
import { useNostr } from '../../app/providers'
import { parseVideoEvent } from '../../nostr/events/video'
import { createRxBackwardReq, createRxForwardReq } from 'rx-nostr'
import { getEventsQuery$ } from '../../nostr/rxNostr'
import { useUserRelayUrls } from '../../nostr/relays'
import { use$ } from 'applesauce-react/hooks'
import { db, VideoShape } from '../../nostr/cache'
import { useLiveQuery } from 'dexie-react-hooks'

import { useSearchParams } from 'react-router-dom'
import { ChevronUp, ChevronDown } from 'lucide-react'

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
  const { rxNostr, session, eventStore } = useNostr()
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
  const relayUrls = useUserRelayUrls(eventStore, session?.pubkey)

  // Query kind 3 replaceable contacts list event for the logged in user
  const contactListEvent = use$(
    () => getEventsQuery$({ kinds: [3], authors: session?.pubkey ? [session.pubkey] : [] }),
    [session?.pubkey]
  )?.[0]

  const followingPubkeys = useMemo(() => {
    if (!contactListEvent) return []
    return contactListEvent.tags.filter((t: any) => t[0] === 'p').map((t: any) => t[1])
  }, [contactListEvent])

  // Track whether we have loaded the user's initial metadata/relay lists from relays
  const [isMetadataLoaded, setIsMetadataLoaded] = useState(false)

  // 1. Subscribe once per pubkey to user's contact list and relay list (kinds 3, 10002)
  useEffect(() => {
    if (!session?.pubkey) {
      setIsMetadataLoaded(true)
      return
    }
    if (userMetadataSubscribedRef.current === session.pubkey) return

    console.log(`Subscribing to user metadata for ${session.pubkey}...`)
    userMetadataSubscribedRef.current = session.pubkey

    const rxReq = createRxForwardReq()
    const sub = rxNostr.use(rxReq, { relays: relayUrls }).subscribe()
    rxReq.emit({ kinds: [3, 10002], authors: [session.pubkey], limit: 1 })

    const timer = setTimeout(() => {
      setIsMetadataLoaded(true)
    }, 400)

    return () => {
      sub.unsubscribe()
      clearTimeout(timer)
    }
  }, [rxNostr, session?.pubkey])

  // 2. Subscribe to real-time events from relays with strict time & limit guards
  useEffect(() => {
    if (!isMetadataLoaded) return
    console.log('Loading initial video backlog from relays (with limit: 50)...')
    const rxReq = createRxBackwardReq()
    const sub = rxNostr.use(rxReq, { relays: relayUrls }).subscribe()
    
    // Strict limits
    rxReq.emit({
      kinds: [21, 22, 34236],
      limit: 200,
      since: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30 // 30 days ago
    })

    return () => {
      sub.unsubscribe()
    }
  }, [rxNostr, relayUrls, isMetadataLoaded])

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
        hasBoosted: shape.userState?.skipped || false, // skipped or boosted placeholders
        hasZapped: shape.userState?.zapped || false,
        music: 'Original Clip Audio',
        finalRankScore: shape.finalRankScore ?? 0,
        mediaStatus: shape.mediaStatus
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

  useEffect(() => {
    oldestLoadedCreatedAtRef.current = videos.length > 0 ? videos[videos.length - 1]?.createdAt ?? null : null
  }, [videos])

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
    const rxReq = createRxBackwardReq()
    const sub = rxNostr.use(rxReq, { relays: relayUrls }).subscribe({
      complete: () => {
        setIsFetchingOlder(false)
      },
      error: (error) => {
        console.error('Failed to load older videos:', error)
        setIsFetchingOlder(false)
      },
    })

    rxReq.emit({
      kinds: [21, 22, 34236],
      limit: PAGE_SIZE,
      until: oldestCreatedAt - 1,
    })

    return () => {
      sub.unsubscribe()
    }
  }, [activeIndex, isFetchingOlder, rxNostr, videos.length, relayUrls])

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

    console.log(`Prefetching reactions/comments progressively near viewport:`, videoIdsToFetch)
    const rxReq = createRxForwardReq()
    const sub = rxNostr.use(rxReq, { relays: relayUrls }).subscribe()
    rxReq.emit({ kinds: [7, 16, 9735, 1111], '#e': videoIdsToFetch })

    return () => {
      sub.unsubscribe()
    }
  }, [rxNostr, activeIndex, videos, relayUrls])

  // Scroll to deep-linked video if present on load
  useEffect(() => {
    if (initialVideoId && videos.length > 0) {
      const idx = videos.findIndex((v: VideoItemData) => v.id === initialVideoId)
      if (idx !== -1) {
        setActiveIndex(idx)
        setTimeout(() => {
          listRef.current?.scrollToRow({ index: idx, align: 'auto', behavior: 'auto' })
        }, 100)
      }
    }
  }, [videos, initialVideoId])

  // Track scroll position, snap, and run diagnostics
  const handleListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollOffset = e.currentTarget.scrollTop
    const containerHeight = e.currentTarget.clientHeight
    const newIndex = Math.round(scrollOffset / containerHeight)
    if (newIndex !== activeIndex && newIndex >= 0 && newIndex < videos.length) {
      setActiveIndex(newIndex)
      
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

      {/* Floating navigation buttons for desktop */}
      <div className="hidden md:flex flex-col gap-3 absolute right-6 top-1/2 -translate-y-1/2 z-30">
        <button
          onClick={() => {
            if (activeIndex > 0) {
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
            if (activeIndex < videos.length - 1) {
              listRef.current?.scrollToRow({ index: activeIndex + 1, align: 'auto', behavior: 'auto' })
            }
          }}
          disabled={activeIndex === videos.length - 1}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-neutral-900/80 border border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 disabled:opacity-30 disabled:pointer-events-none transition-all duration-200 active:scale-95 shadow-lg cursor-pointer"
          title="Next Video"
        >
          <ChevronDown className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}
