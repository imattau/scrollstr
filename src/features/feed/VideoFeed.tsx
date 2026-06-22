import React, { useEffect, useRef, useState, useMemo } from 'react'
import { VideoFeedItem, VideoItemData } from './VideoFeedItem'
import { useNostr } from '../../app/providers'
import { parseVideoEvent } from '../../nostr/events/video'
import { createRxForwardReq } from 'rx-nostr'
import { getEventsQuery$ } from '../../nostr/rxNostr'
import { use$ } from 'applesauce-react/hooks'

import { useSearchParams } from 'react-router-dom'

interface VideoFeedProps {
  onActionTrigger: (actionType: string, videoId: string, creatorPubkey?: string) => void
}

export const VideoFeed: React.FC<VideoFeedProps> = ({ onActionTrigger }) => {
  const { rxNostr } = useNostr()
  const [searchParams] = useSearchParams()
  const filterTag = searchParams.get('tag')
  const initialVideoId = searchParams.get('v')
  
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  // Query kind:22 events from Applesauce EventStore
  const rawVideoEvents = use$(() => getEventsQuery$({ kinds: [22] }), []) || []

  // Subscribe to real-time events from relays
  useEffect(() => {
    console.log('Subscribing to Nostr kind:22 events via rx-nostr...')
    const rxReq = createRxForwardReq()
    const sub = rxNostr.use(rxReq).subscribe()
    rxReq.emit({ kinds: [22], limit: 40 })

    return () => {
      sub.unsubscribe()
    }
  }, [rxNostr])

  // Parse events to local format and filter out invalid/null ones
  const videos = useMemo(() => {
    let list = rawVideoEvents
      .map((ev: any) => parseVideoEvent(ev))
      .filter((v: any): v is VideoItemData => v !== null)

    if (filterTag) {
      list = list.filter((v) =>
        v.hashtags?.some((t) => t.toLowerCase() === filterTag.toLowerCase())
      )
    }

    return list
  }, [rawVideoEvents, filterTag])

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

  // Track active index on vertical scroll snap
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      const scrollPos = container.scrollTop
      const height = container.clientHeight
      const newIndex = Math.round(scrollPos / height)
      
      if (newIndex !== activeIndex && newIndex >= 0 && newIndex < videos.length) {
        setActiveIndex(newIndex)
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => {
      container.removeEventListener('scroll', handleScroll)
    }
  }, [activeIndex, videos])

  const handleActionClick = (action: string, videoId: string) => {
    const video = videos.find((v) => v.id === videoId)
    onActionTrigger(action, videoId, video?.creator.pubkey)
  }

  if (videos.length === 0) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-[#09090b] text-[#a1a1aa] md:h-full">
        <p className="text-[14px]">Connecting to relays and loading videos...</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="feed-container relative h-dvh w-full md:h-full"
    >
      {videos.map((video, idx) => (
        <VideoFeedItem
          key={video.id}
          video={video}
          isActive={idx === activeIndex}
          onActionClick={handleActionClick}
        />
      ))}
    </div>
  )
}
