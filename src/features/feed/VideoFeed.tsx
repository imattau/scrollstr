import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { List } from 'react-window'
import { VideoFeedItem, VideoItemData } from './VideoFeedItem'
import { useNostr } from '../../app/providers'
import { parseVideoEvent } from '../../nostr/events/video'
import { createRxBackwardReq, createRxForwardReq } from 'rx-nostr'
import { getEventsQuery$ } from '../../nostr/rxNostr'
import { useUserRelayUrls } from '../../nostr/relays'
import { use$ } from 'applesauce-react/hooks'

import { useSearchParams } from 'react-router-dom'

const EMPTY_VIDEOS: any[] = []
const PAGE_SIZE = 20
const LOAD_MORE_THRESHOLD = 3
const LOCAL_PREVIEW_ID = 'local-preview-neon-mascot'

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
  const containerRef = useRef<HTMLDivElement>(null)
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

  // Subscribe to real-time events from relays
  useEffect(() => {
    console.log('Loading initial video backlog from relays...')
    const rxReq = createRxBackwardReq()
    const sub = rxNostr.use(rxReq, { relays: relayUrls }).subscribe()
    rxReq.emit({ kinds: [21, 22, 34236], limit: 40 })

    return () => {
      sub.unsubscribe()
    }
  }, [rxNostr, relayUrls])

  // Subscribe to future video events after the initial backlog load
  useEffect(() => {
    console.log('Subscribing to live Nostr video events...')
    const rxReq = createRxForwardReq()
    const sub = rxNostr.use(rxReq, { relays: relayUrls }).subscribe()
    rxReq.emit({ kinds: [21, 22, 34236] })

    return () => {
      sub.unsubscribe()
    }
  }, [rxNostr, relayUrls])

  // Subscribe once per pubkey to user's contact list and relay list (kinds 3, 10002)
  // Only re-subscribe if pubkey changes, not on relayUrls changes to avoid circular dependency
  useEffect(() => {
    if (!session?.pubkey) return
    if (userMetadataSubscribedRef.current === session.pubkey) return

    console.log(`Subscribing to user metadata for ${session.pubkey}...`)
    userMetadataSubscribedRef.current = session.pubkey

    const rxReq = createRxForwardReq()
    const sub = rxNostr.use(rxReq, { relays: relayUrls }).subscribe()
    rxReq.emit({ kinds: [3, 10002], authors: [session.pubkey], limit: 1 })

    return () => {
      sub.unsubscribe()
    }
  }, [rxNostr, session?.pubkey])

  // Batch query all reactions once (prevents O(n*4) queries)
  const allReactions = eventStore.getByFilters({ kinds: [7, 16, 6, 9735, 1111], limit: 10000 })

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
          const container = containerRef.current
          if (container) {
            const targetEl = container.children[idx] as HTMLElement
            if (targetEl) {
              targetEl.scrollIntoView({ behavior: 'auto' })
            }
          }
        }, 100)
      }
    }
  }, [videos, initialVideoId])

  const itemHeight = typeof window !== 'undefined' ? window.innerHeight : 800

  // Track scroll position and snap to nearest video
  const handleListScroll = useCallback(({ scrollOffset }: any) => {
    const newIndex = Math.round(scrollOffset / itemHeight)
    if (newIndex !== activeIndex && newIndex >= 0 && newIndex < videos.length) {
      setActiveIndex(newIndex)
    }
  }, [activeIndex, itemHeight, videos.length])

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
      <div
        ref={containerRef}
        className="feed-container relative h-dvh w-full md:h-full"
        style={{ height: itemHeight }}
      >
        <List
          defaultHeight={itemHeight}
          rowCount={videos.length + (isFetchingOlder ? 1 : 0)}
          rowHeight={itemHeight}
          style={{ width: '100%' }}
          onScroll={handleListScroll}
          onRowsRendered={() => {}}
          rowProps={{}}
          rowComponent={({ index, style }: any) => {
            if (index === videos.length) {
              return (
                <div style={style} className="flex h-dvh w-full items-center justify-center bg-[#09090b] text-[#a1a1aa]">
                  <p className="text-[14px]">Loading older videos...</p>
                </div>
              )
            }
            const video = videos[index]
            return (
              <div style={style} key={video.id}>
                <VideoFeedItem
                  video={video}
                  isActive={index === activeIndex}
                  isMuted={isMuted}
                  onActionClick={handleActionClick}
                />
              </div>
            )
          }}
        />
      </div>
    )
  }
