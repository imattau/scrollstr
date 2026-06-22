import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { List, ListImperativeAPI } from 'react-window'
import { VideoFeedItem, VideoItemData } from './VideoFeedItem'
import { useNostr } from '../../app/providers'
import { parseVideoEvent } from '../../nostr/events/video'
import { createRxBackwardReq, createRxForwardReq } from 'rx-nostr'
import { getEventsQuery$ } from '../../nostr/rxNostr'
import { useUserRelayUrls } from '../../nostr/relays'
import { use$ } from 'applesauce-react/hooks'

import { useSearchParams } from 'react-router-dom'
import { ChevronUp, ChevronDown } from 'lucide-react'

const EMPTY_VIDEOS: any[] = []
const PAGE_SIZE = 20
const LOAD_MORE_THRESHOLD = 3
const LOCAL_PREVIEW_ID = 'local-preview-neon-mascot'

interface VideoRowProps {
  videos: any[]
  isFetchingOlder: boolean
  activeIndex: number
  isMuted: boolean
  handleActionClick: (action: string, videoId: string, videoKind?: number) => void
}

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
        isActive={index === activeIndex}
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

  // Query short-video events from Applesauce EventStore
  const rawVideoEvents = use$(() => getEventsQuery$({ kinds: [21, 22, 34236] }), []) ?? EMPTY_VIDEOS

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
  // Only re-subscribe if pubkey changes, not on relayUrls changes to avoid circular dependency
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

    // Small delay to allow subscription and initial load from bootstrap/fallback relays before fetching videos
    const timer = setTimeout(() => {
      setIsMetadataLoaded(true)
    }, 400)

    return () => {
      sub.unsubscribe()
      clearTimeout(timer)
    }
  }, [rxNostr, session?.pubkey])

  // 2. Subscribe to real-time events from relays (only after metadata has resolved/checked)
  useEffect(() => {
    if (!isMetadataLoaded) return
    console.log('Loading initial video backlog from relays...')
    const rxReq = createRxBackwardReq()
    const sub = rxNostr.use(rxReq, { relays: relayUrls }).subscribe()
    rxReq.emit({ kinds: [21, 22, 34236], limit: 40 })

    return () => {
      sub.unsubscribe()
    }
  }, [rxNostr, relayUrls, isMetadataLoaded])

  // 3. Subscribe to future video events after the initial backlog load
  useEffect(() => {
    if (!isMetadataLoaded) return
    console.log('Subscribing to live Nostr video events...')
    const rxReq = createRxForwardReq()
    const sub = rxNostr.use(rxReq, { relays: relayUrls }).subscribe()
    rxReq.emit({ kinds: [21, 22, 34236] })

    return () => {
      sub.unsubscribe()
    }
  }, [rxNostr, relayUrls, isMetadataLoaded])

  // Batch query all reactions once (prevents O(n*4) queries)
  const allReactions = use$(() => getEventsQuery$({ kinds: [7, 16, 6, 9735, 1111] }), []) ?? EMPTY_VIDEOS

  // Index reactions by videoId for O(1) lookup
  const reactionsByVideoId = useMemo(() => {
    const map = new Map()
    allReactions.forEach((event: any) => {
      const videoId = event.tags.find((t: any) => t[0] === 'e')?.[1]
      if (!videoId) return
      if (!map.has(videoId)) map.set(videoId, [])
      map.get(videoId).push(event)
    })
    return map
  }, [allReactions])

  // Parse events to local format, filter, and enrich with live reaction counts from EventStore
  // Removed eventStore from deps to prevent recalc on every event. Reactions update via eventStore queries below.
  const videos = useMemo(() => {
    const sortedRawEvents = [...rawVideoEvents].sort((a: any, b: any) => {
      if (a.id === LOCAL_PREVIEW_ID) return -1
      if (b.id === LOCAL_PREVIEW_ID) return 1

      const createdAtDiff = (b.created_at ?? 0) - (a.created_at ?? 0)
      if (createdAtDiff !== 0) return createdAtDiff

      return String(a.id).localeCompare(String(b.id))
    })

    let list = sortedRawEvents
      .map((ev: any) => parseVideoEvent(ev))
      .filter((v: any): v is VideoItemData => v !== null)

    if (filterTag) {
      list = list.filter((v) =>
        v.hashtags?.some((t) => t.toLowerCase() === filterTag.toLowerCase())
      )
    }

    if (feedType === 'following' && session) {
      list = list.filter((v) => followingPubkeys.includes(v.creator.pubkey))
    }

    return list.map((video) => {
      const reactions = reactionsByVideoId.get(video.id) || []
      const likes = reactions.filter((e: any) => e.kind === 7)
      const comments = reactions.filter((e: any) => e.kind === 1111)
      const boosts = reactions.filter((e: any) => e.kind === 6 || e.kind === 16)
      const zaps = reactions.filter((e: any) => e.kind === 9735)

      const hasLiked = session ? likes.some((l: any) => l.pubkey === session.pubkey) : false
      const hasBoosted = session ? boosts.some((b: any) => b.pubkey === session.pubkey) : false
      const hasZapped = session ? zaps.some((z: any) => z.pubkey === session.pubkey) : false

      return {
        ...video,
        likesCount: likes.length,
        commentsCount: comments.length,
        boostsCount: boosts.length,
        zapsCount: zaps.length,
        hasLiked,
        hasBoosted,
        hasZapped,
      }
    })
  }, [rawVideoEvents, filterTag, feedType, followingPubkeys, session, reactionsByVideoId])

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

  // Prefetch comments, likes, boosts, and zaps for the active video and the next upcoming video
  // Only trigger on activeIndex change, not on entire videos array change (prevents cascading re-subscriptions)
  useEffect(() => {
    if (videos.length === 0) return
    const activeVideo = videos[activeIndex]
    const nextVideo = videos[activeIndex + 1]
    if (!activeVideo) return

    const videoIdsToFetch = [activeVideo.id]
    if (nextVideo) {
      videoIdsToFetch.push(nextVideo.id)
    }

    console.log(`Prefetching reactions and comments for videos:`, videoIdsToFetch)
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
      const idx = videos.findIndex((v) => v.id === initialVideoId)
      if (idx !== -1) {
        setActiveIndex(idx)
        // Small timeout to allow render completion
        setTimeout(() => {
          listRef.current?.scrollToRow({ index: idx, align: 'auto', behavior: 'auto' })
        }, 100)
      }
    }
  }, [videos, initialVideoId])

  // Track scroll position and snap to nearest video
  const handleListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollOffset = e.currentTarget.scrollTop
    const containerHeight = e.currentTarget.clientHeight
    const newIndex = Math.round(scrollOffset / containerHeight)
    if (newIndex !== activeIndex && newIndex >= 0 && newIndex < videos.length) {
      setActiveIndex(newIndex)
    }
  }, [activeIndex, videos.length])

  // Keyboard navigation for desktop view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore keydowns when user is typing in input, textarea, select or contenteditable
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
    const video = videos.find((v) => v.id === videoId)
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
