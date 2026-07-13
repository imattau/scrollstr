import React, { useMemo, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { VideoPlayer } from '../video/VideoPlayer'
import { useProfile } from '../../nostr/profile'
import { loadSettings } from '../../db/local-preferences'
import { Heart, MessageCircle, Repeat2, Zap, Volume2, VolumeX, Share2, EyeOff, AlertTriangle, SkipForward } from 'lucide-react'

export interface CreatorProfile {
  pubkey: string
  name: string
  displayName?: string
  picture?: string
  nip05?: string
  isVerified?: boolean
  about?: string
  website?: string
}

export interface VideoItemData {
  id: string
  kind?: number
  createdAt?: number
  firstSeen?: number
  insertOrder?: number
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
  hasLiked?: boolean
  hasBoosted?: boolean
  hasZapped?: boolean
  mediaStatus?: string
  width?: number
  height?: number
  duration?: number
  size?: number
  mimeType?: string
}

interface VideoFeedItemProps {
  video: VideoItemData
  isActive: boolean
  isNearActive: boolean
  isMuted: boolean
  onActionClick: (action: 'like' | 'comment' | 'boost' | 'zap' | 'share' | 'more' | 'mute', videoId: string, videoKind?: number) => void
  uiHidden: boolean
  onUiHiddenChange: (hidden: boolean) => void
  autoScroll?: boolean
  onVideoEnded?: () => void
}

function ActionPill({
  icon,
  label,
  labelColor = 'text-[#f7f7f8]',
  iconColor = 'text-[#f7f7f8]',
  onClick,
}: {
  icon: React.ReactNode
  label?: string
  labelColor?: string
  iconColor?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-[3px] outline-none transition-transform duration-150 active:scale-95"
    >
      <span
        className={[
          'flex size-[42px] items-center justify-center rounded-full border border-transparent text-[19px] leading-none',
          'bg-[#18181d]/80 backdrop-blur-sm shadow-md hover:bg-[#27272a]/90 transition-colors',
          iconColor,
        ].join(' ')}
      >
        {icon}
      </span>
      {label ? <span className={['text-[10px] font-medium leading-none', labelColor].join(' ')}>{label}</span> : null}
    </button>
  )
}

const VideoFeedItemComponent: React.FC<VideoFeedItemProps> = ({ video, isActive, isNearActive, isMuted, onActionClick, uiHidden, onUiHiddenChange, autoScroll, onVideoEnded }) => {
  const navigate = useNavigate()
  const profile = useProfile(video.creator.pubkey)
  const creatorLabel = useMemo(() => `@${profile.displayName || profile.name}`, [profile.displayName, profile.name])
  const [showInfo, setShowInfo] = useState(false)
  const [nsfwRevealed, setNsfwRevealed] = useState(false)
  const isNsfwBlurred = useMemo(() => {
    const s = loadSettings()
    if (!s.nsfwBlur) return false
    const hasContentWarning = !!video.contentWarning
    const isCreatorNsfw = s.nsfwPubkeys?.includes(video.creator.pubkey) ?? false
    return (hasContentWarning || isCreatorNsfw) && !nsfwRevealed
  }, [nsfwRevealed, video.contentWarning, video.creator.pubkey])

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLongPress = useRef(false)
  const onLike = useCallback(() => onActionClick('like', video.id, video.kind), [onActionClick, video.id, video.kind])

  const handleTouchStart = useCallback(() => {
    isLongPress.current = false
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true
      const next = !uiHidden
      onUiHiddenChange(next)
      setShowInfo(!next)
    }, 400)
  }, [onUiHiddenChange, uiHidden])

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const handleTouchMove = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  return (
    <article
      className="feed-item relative h-full w-full select-none overflow-hidden bg-[#1b1327] md:mx-auto md:my-3 md:h-[calc(100%-24px)] md:w-[430px] md:rounded-[18px]"
      onMouseEnter={() => setShowInfo(true)}
      onMouseLeave={() => setShowInfo(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,rgba(99,102,241,0.08),transparent_32%),radial-gradient(circle_at_50%_12%,rgba(167,139,250,0.06),transparent_24%),linear-gradient(180deg,#1b1327_0%,#1b1327_66%,#09090b_100%)]" />

      <div className="absolute inset-0 z-0">
        <VideoPlayer
          url={video.url}
          poster={video.poster}
          isActive={isActive && !isNsfwBlurred}
          isNearActive={isNearActive}
          isMuted={isMuted}
          onLike={onLike}
          showControls={false}
          autoScroll={autoScroll}
          onVideoEnded={onVideoEnded}
        />
      </div>

      {(video.mediaStatus === 'failed' || video.mediaStatus === 'too_large' || video.mediaStatus === 'unsupported') && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/80">
          <AlertTriangle className="w-10 h-10 text-[#a1a1aa]" />
          <span className="text-[15px] font-semibold text-[#f7f7f8]">
            {video.mediaStatus === 'failed' && 'Failed to load'}
            {video.mediaStatus === 'too_large' && 'Video too large'}
            {video.mediaStatus === 'unsupported' && 'Unsupported format'}
          </span>
          <span className="text-[12px] text-[#a1a1aa] text-center px-8">
            {video.mediaStatus === 'failed' && 'This video could not be loaded from the server.'}
            {video.mediaStatus === 'too_large' && 'This video exceeds the maximum file size.'}
            {video.mediaStatus === 'unsupported' && 'Your browser does not support this video format.'}
          </span>
          <span className="flex items-center gap-1 mt-1 text-[11px] text-[#71717a]">
            <SkipForward className="w-3 h-3" />
            Scroll past to continue
          </span>
        </div>
      )}

      {isNsfwBlurred && (
        <button
          type="button"
          onClick={() => setNsfwRevealed(true)}
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-xl cursor-pointer transition-opacity"
        >
          <EyeOff className="w-10 h-10 text-[#a1a1aa]" />
          <span className="text-[15px] font-semibold text-[#f7f7f8]">NSFW</span>
          <span className="text-[12px] text-[#a1a1aa]">Tap to view</span>
        </button>
      )}

      <div className={`absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#09090b]/18 transition-opacity duration-300 ${uiHidden ? 'opacity-0' : ''}`} />

      <div className={`absolute right-4 top-[220px] z-20 flex flex-col items-center gap-[13px] md:right-[-1px] md:top-[260px] transition-all duration-300 ${uiHidden ? 'opacity-0 pointer-events-none' : ''}`}>
        <button
          type="button"
          onClick={() => navigate(`/profile/${video.creator.pubkey}`)}
          className="flex size-[44px] overflow-hidden items-center justify-center rounded-full bg-[#60a5fa] text-[15px] font-bold text-white transition-transform duration-150 active:scale-95"
          aria-label="Creator"
        >
          {profile.picture ? (
            <img src={profile.picture} alt={profile.name} className="h-full w-full object-cover" />
          ) : (
            profile.displayName?.slice(0, 1).toUpperCase() || 'N'
          )}
        </button>

        <ActionPill
          icon={<Heart size={18} className={video.hasLiked ? 'fill-red-500 text-red-500' : ''} />}
          iconColor={video.hasLiked ? 'text-red-500' : 'text-[#f7f7f8]'}
          label={video.likesCount >= 1000 ? `${(video.likesCount / 1000).toFixed(video.likesCount % 1000 === 0 ? 0 : 1)}k` : `${video.likesCount}`}
          onClick={() => onActionClick('like', video.id, video.kind)}
        />
        <ActionPill
          icon={<MessageCircle size={18} />}
          label={video.commentsCount >= 1000 ? `${(video.commentsCount / 1000).toFixed(video.commentsCount % 1000 === 0 ? 0 : 1)}k` : `${video.commentsCount}`}
          onClick={() => onActionClick('comment', video.id, video.kind)}
        />
        <ActionPill
          icon={<Repeat2 size={18} className={video.hasBoosted ? 'text-green-500' : ''} />}
          iconColor={video.hasBoosted ? 'text-green-500' : 'text-[#f7f7f8]'}
          label={video.boostsCount >= 1000 ? `${(video.boostsCount / 1000).toFixed(video.boostsCount % 1000 === 0 ? 0 : 1)}k` : `${video.boostsCount}`}
          onClick={() => onActionClick('boost', video.id, video.kind)}
        />
        <ActionPill
          icon={<Zap size={18} className="fill-current" />}
          label={video.zapsCount >= 1000 ? `${(video.zapsCount / 1000).toFixed(video.zapsCount % 1000 === 0 ? 0 : 1)}k` : `${video.zapsCount}`}
          labelColor="text-[#f7f7f8]"
          iconColor={video.hasZapped ? 'text-yellow-500' : 'text-[#f5b942]'}
          onClick={() => onActionClick('zap', video.id, video.kind)}
        />
        <ActionPill
          icon={isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          label={isMuted ? 'Muted' : 'Unmuted'}
          onClick={() => onActionClick('mute', video.id, video.kind)}
        />
        <ActionPill
          icon={<Share2 size={18} />}
          onClick={() => onActionClick('share', video.id, video.kind)}
        />
      </div>

      <div className={`absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-[#09090b]/90 via-[#09090b]/60 to-transparent transition-all duration-300 ${showInfo && !uiHidden ? 'h-[230px] md:h-[120px]' : 'h-0 overflow-hidden'}`}>
        <div className={`absolute left-4 w-[278px] max-w-[calc(100%-96px)] space-y-[6px] leading-none md:left-[18px] md:w-[320px] transition-all duration-300 ${showInfo ? 'bottom-[16px] opacity-100' : 'bottom-[-10px] opacity-0'}`}>
          <p className="text-[15px] font-semibold text-[#f7f7f8]">
            {creatorLabel} {profile.isVerified ? '✓' : ''}
          </p>
          <div className="block w-full text-left text-[14px] font-normal text-[#f7f7f8]">
            <span className="block leading-[1.35]">
              {video.description || video.title}
            </span>
            {video.duration && (
              <span className="text-[12px] text-[#a1a1aa] mt-1">
                {Math.floor(video.duration / 60)}:{String(Math.floor(video.duration % 60)).padStart(2, '0')}
              </span>
            )}
          </div>
          <p className="text-[12px] font-medium text-[#a78bfa]">
            {(video.hashtags || ['melbourne', 'nightwalk', 'nostr']).map((tag) => `#${tag}`).join('  ')}
          </p>
        </div>
      </div>
    </article>
  )
}

export const VideoFeedItem = React.memo(VideoFeedItemComponent, (prevProps, nextProps) => {
  return prevProps.video.id === nextProps.video.id &&
    prevProps.video.likesCount === nextProps.video.likesCount &&
    prevProps.video.commentsCount === nextProps.video.commentsCount &&
    prevProps.video.boostsCount === nextProps.video.boostsCount &&
    prevProps.video.zapsCount === nextProps.video.zapsCount &&
    prevProps.video.hasLiked === nextProps.video.hasLiked &&
    prevProps.video.hasBoosted === nextProps.video.hasBoosted &&
    prevProps.video.hasZapped === nextProps.video.hasZapped &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.isNearActive === nextProps.isNearActive &&
    prevProps.isMuted === nextProps.isMuted &&
    prevProps.uiHidden === nextProps.uiHidden
})
