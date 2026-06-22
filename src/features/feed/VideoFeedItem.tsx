import React, { useState } from 'react'
import { Heart, MessageCircle, Repeat2, Zap, Share2, MoreHorizontal, Volume2, VolumeX, CheckCircle } from 'lucide-react'
import { VideoPlayer } from '../video/VideoPlayer'

export interface CreatorProfile {
  pubkey: string
  name: string
  displayName?: string
  picture?: string
  nip05?: string
  isVerified?: boolean
}

export interface VideoItemData {
  id: string
  title?: string
  description?: string
  url: string
  poster?: string
  creator: CreatorProfile
  hashtags?: string[]
  likesCount: number
  commentsCount: number
  boostsCount: number
  zapsCount: number
  music?: string
  contentWarning?: string
}

interface VideoFeedItemProps {
  video: VideoItemData
  isActive: boolean
  onActionClick: (action: 'like' | 'comment' | 'boost' | 'zap' | 'share' | 'more' | 'follow', videoId: string) => void
}

export const VideoFeedItem: React.FC<VideoFeedItemProps> = ({ video, isActive, onActionClick }) => {
  const [descExpanded, setDescExpanded] = useState(false)
  const [muted, setMuted] = useState(true)

  const toggleMuted = () => setMuted(!muted)

  const handleDoubleTapLike = () => {
    onActionClick('like', video.id)
  }

  return (
    <div className="feed-item w-full h-full relative bg-neutral-950 flex flex-col justify-between select-none">
      
      {/* Video Player */}
      <div className="absolute inset-0 z-0">
        <VideoPlayer
          url={video.url}
          poster={video.poster}
          isActive={isActive}
          onLike={handleDoubleTapLike}
        />
      </div>

      {/* Floating Header (Nostr Clips Logo / Search / Tabs) */}
      <header className="absolute top-0 left-0 right-0 z-10 px-4 py-6 bg-gradient-to-b from-black/60 to-transparent flex justify-between items-center">
        <div className="text-lg font-bold text-white tracking-wide">Nostr Clips</div>
        <div className="flex gap-4 text-sm font-semibold text-neutral-300">
          <span className="text-white border-b-2 border-purple-500 pb-1">Explore</span>
          <span className="hover:text-white cursor-pointer" onClick={() => onActionClick('more', video.id)}>Following</span>
        </div>
      </header>

      {/* Bottom-left Content Block & Right Action Rail Overlay */}
      <div className="absolute bottom-16 md:bottom-6 left-0 right-0 z-10 px-4 pb-4 flex justify-between items-end bg-gradient-to-t from-black/80 via-black/20 to-transparent pt-12">
        
        {/* Creator Info & Description */}
        <div className="flex-1 max-w-[75%] space-y-3 text-white">
          <div className="flex items-center gap-2">
            <div className="relative cursor-pointer" onClick={() => onActionClick('follow', video.id)}>
              <img
                src={video.creator.picture || 'https://api.dicebear.com/7.x/bottts/svg?seed=' + video.creator.pubkey}
                alt={video.creator.name}
                className="w-10 h-10 rounded-full border border-purple-500 bg-neutral-900 object-cover"
              />
              <span className="absolute -bottom-1 -right-1 bg-purple-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold border border-black">
                +
              </span>
            </div>
            <div>
              <div className="flex items-center gap-1 font-semibold text-sm cursor-pointer">
                <span>@{video.creator.displayName || video.creator.name}</span>
                {video.creator.isVerified && (
                  <CheckCircle className="w-3.5 h-3.5 fill-purple-500 text-black" />
                )}
              </div>
              {video.creator.nip05 && (
                <span className="text-[10px] text-purple-300 block leading-tight">{video.creator.nip05}</span>
              )}
            </div>
          </div>

          {/* Video Description */}
          <div className="text-xs text-neutral-200">
            <p
              onClick={() => setDescExpanded(!descExpanded)}
              className={`cursor-pointer transition-all duration-200 ${
                descExpanded ? 'line-clamp-none' : 'line-clamp-2'
              }`}
            >
              {video.description || video.title}
            </p>
            {video.hashtags && video.hashtags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1 text-purple-400 font-medium">
                {video.hashtags.map((tag) => (
                  <span key={tag} className="hover:underline cursor-pointer">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Music/Source Info */}
          {video.music && (
            <div className="flex items-center gap-1.5 text-[10px] text-neutral-400">
              <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse shrink-0" />
              <span className="truncate">{video.music}</span>
            </div>
          )}

          {/* Content Warning Label */}
          {video.contentWarning && (
            <div className="inline-flex items-center px-2 py-0.5 rounded bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 text-[10px] font-medium">
              CW: {video.contentWarning}
            </div>
          )}
        </div>

        {/* Right Action Rail */}
        <div className="flex flex-col items-center gap-4 text-white shrink-0">
          
          {/* Like */}
          <button
            onClick={() => onActionClick('like', video.id)}
            className="flex flex-col items-center gap-1 hover:scale-105 transition-transform"
          >
            <div className="w-11 h-11 rounded-full bg-neutral-900/60 backdrop-blur-md flex items-center justify-center border border-neutral-800">
              <Heart className="w-5 h-5 text-neutral-200 hover:text-red-500 transition-colors" />
            </div>
            <span className="text-[10px] font-medium">{video.likesCount}</span>
          </button>

          {/* Comments */}
          <button
            onClick={() => onActionClick('comment', video.id)}
            className="flex flex-col items-center gap-1 hover:scale-105 transition-transform"
          >
            <div className="w-11 h-11 rounded-full bg-neutral-900/60 backdrop-blur-md flex items-center justify-center border border-neutral-800">
              <MessageCircle className="w-5 h-5 text-neutral-200 hover:text-purple-400 transition-colors" />
            </div>
            <span className="text-[10px] font-medium">{video.commentsCount}</span>
          </button>

          {/* Boost */}
          <button
            onClick={() => onActionClick('boost', video.id)}
            className="flex flex-col items-center gap-1 hover:scale-105 transition-transform"
          >
            <div className="w-11 h-11 rounded-full bg-neutral-900/60 backdrop-blur-md flex items-center justify-center border border-neutral-800">
              <Repeat2 className="w-5 h-5 text-neutral-200 hover:text-green-400 transition-colors" />
            </div>
            <span className="text-[10px] font-medium">{video.boostsCount}</span>
          </button>

          {/* Zap */}
          <button
            onClick={() => onActionClick('zap', video.id)}
            className="flex flex-col items-center gap-1 hover:scale-105 transition-transform"
          >
            <div className="w-11 h-11 rounded-full bg-yellow-500/10 backdrop-blur-md flex items-center justify-center border border-yellow-500/30">
              <Zap className="w-5 h-5 text-yellow-400" />
            </div>
            <span className="text-[10px] font-medium text-yellow-400">{video.zapsCount}</span>
          </button>

          {/* Share */}
          <button
            onClick={() => onActionClick('share', video.id)}
            className="flex flex-col items-center gap-1 hover:scale-105 transition-transform"
          >
            <div className="w-11 h-11 rounded-full bg-neutral-900/60 backdrop-blur-md flex items-center justify-center border border-neutral-800">
              <Share2 className="w-5 h-5 text-neutral-200 hover:text-blue-400 transition-colors" />
            </div>
          </button>

          {/* More */}
          <button
            onClick={() => onActionClick('more', video.id)}
            className="flex flex-col items-center gap-1 hover:scale-105 transition-transform"
          >
            <div className="w-11 h-11 rounded-full bg-neutral-900/60 backdrop-blur-md flex items-center justify-center border border-neutral-800">
              <MoreHorizontal className="w-5 h-5 text-neutral-200" />
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
