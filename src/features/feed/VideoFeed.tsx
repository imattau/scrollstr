import React, { useState, useEffect, useRef } from 'react'
import { VideoFeedItem, VideoItemData } from './VideoFeedItem'

const MOCK_VIDEOS: VideoItemData[] = [
  {
    id: 'video-1',
    title: 'Sailing under the sunset',
    description: 'Caught this incredible view while sailing off the coast today! #sailing #ocean #sunset #aesthetic',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    poster: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=500&auto=format&fit=crop&q=60',
    creator: {
      pubkey: 'npub1creator1...',
      name: 'captain_ocean',
      displayName: 'Captain Ocean',
      picture: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=60',
      nip05: 'ocean@nostr.com',
      isVerified: true,
    },
    hashtags: ['sailing', 'ocean', 'sunset', 'aesthetic'],
    likesCount: 1240,
    commentsCount: 89,
    boostsCount: 45,
    zapsCount: 8200,
    music: 'Original Audio - Captain Ocean',
  },
  {
    id: 'video-2',
    title: 'Mountain biking downhill',
    description: 'Testing the new suspension on some rocky descents. Adrenaline level 100! #biking #sports #adventure #nature',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    poster: 'https://images.unsplash.com/photo-1541614101331-1a5a3a194e92?w=500&auto=format&fit=crop&q=60',
    creator: {
      pubkey: 'npub1creator2...',
      name: 'trail_runner',
      displayName: 'Trail Blazer',
      picture: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&auto=format&fit=crop&q=60',
      nip05: 'trail@blazer.net',
      isVerified: false,
    },
    hashtags: ['biking', 'sports', 'adventure', 'nature'],
    likesCount: 940,
    commentsCount: 54,
    boostsCount: 22,
    zapsCount: 4200,
    music: 'Synthesized Beat - Audio Library',
  },
  {
    id: 'video-3',
    title: 'Making the perfect morning pour-over',
    description: 'Slow mornings call for good coffee. Here is my daily ritual. ☕️ #coffee #barista #slowliving #pour-over',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    poster: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=500&auto=format&fit=crop&q=60',
    creator: {
      pubkey: 'npub1creator3...',
      name: 'caffeine_fiend',
      displayName: 'Barista Pete',
      picture: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=60',
      nip05: 'pete@caffeine.fm',
      isVerified: true,
    },
    hashtags: ['coffee', 'barista', 'slowliving'],
    likesCount: 3420,
    commentsCount: 241,
    boostsCount: 104,
    zapsCount: 15400,
    music: 'Lo-Fi Chill - Lofi Productions',
  },
]

interface VideoFeedProps {
  onActionTrigger: (actionType: string) => void
}

export const VideoFeed: React.FC<VideoFeedProps> = ({ onActionTrigger }) => {
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      const scrollPos = container.scrollTop
      const height = container.clientHeight
      const newIndex = Math.round(scrollPos / height)
      if (newIndex !== activeIndex && newIndex >= 0 && newIndex < MOCK_VIDEOS.length) {
        setActiveIndex(newIndex)
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => {
      container.removeEventListener('scroll', handleScroll)
    }
  }, [activeIndex])

  const handleActionClick = (action: string, videoId: string) => {
    console.log(`Action: ${action} triggered on video: ${videoId}`)
    
    // Check if authorization is required
    const requiresAuth = ['like', 'comment', 'boost', 'zap', 'follow'].includes(action)
    if (requiresAuth) {
      onActionTrigger(action)
    } else {
      alert(`Triggered ${action} on video ${videoId}`)
    }
  }

  return (
    <div
      ref={containerRef}
      className="feed-container w-full h-full relative"
    >
      {MOCK_VIDEOS.map((video, idx) => (
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
