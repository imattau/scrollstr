import React from 'react'
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
          'bg-[#18181d]',
          iconColor,
        ].join(' ')}
      >
        {icon}
      </span>
      {label ? <span className={['text-[10px] font-medium leading-none', labelColor].join(' ')}>{label}</span> : null}
    </button>
  )
}

import { useProfile } from '../../nostr/profile'

export const VideoFeedItem: React.FC<VideoFeedItemProps> = ({ video, isActive, onActionClick }) => {
  const profile = useProfile(video.creator.pubkey)
  const creatorLabel = `@${profile.displayName || profile.name}`

  return (
    <article className="feed-item relative h-dvh w-full select-none overflow-hidden bg-[#1b1327] md:mx-auto md:mt-[84px] md:h-[780px] md:w-[430px] md:rounded-[18px]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,rgba(99,102,241,0.08),transparent_32%),radial-gradient(circle_at_50%_12%,rgba(167,139,250,0.06),transparent_24%),linear-gradient(180deg,#1b1327_0%,#1b1327_66%,#09090b_100%)]" />

      <div className="absolute inset-0 opacity-20 saturate-0 brightness-75">
        <VideoPlayer url={video.url} poster={video.poster} isActive={isActive} onLike={() => onActionClick('like', video.id)} showControls={false} />
      </div>

      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#09090b]/18" />

      <div className="pointer-events-none absolute left-1/2 top-[39.5%] z-20 -translate-x-1/2 -translate-y-1/2">
        <div
          className="flex size-[62px] items-center justify-center rounded-full bg-[#18181d]/80 text-[19px] text-[#f7f7f8] shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-sm"
          aria-hidden="true"
        >
          <span className="ml-[3px]">▶</span>
        </div>
      </div>

      <div className="absolute right-4 top-[250px] z-20 flex flex-col items-center gap-[13px] md:right-[-1px] md:top-[290px]">
        <button
          type="button"
          onClick={() => onActionClick('follow', video.id)}
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
          icon="♥"
          label={video.likesCount >= 1000 ? `${(video.likesCount / 1000).toFixed(video.likesCount % 1000 === 0 ? 0 : 1)}k` : `${video.likesCount}`}
          onClick={() => onActionClick('like', video.id)}
        />
        <ActionPill
          icon="◌"
          label={video.commentsCount >= 1000 ? `${(video.commentsCount / 1000).toFixed(video.commentsCount % 1000 === 0 ? 0 : 1)}k` : `${video.commentsCount}`}
          onClick={() => onActionClick('comment', video.id)}
        />
        <ActionPill
          icon="↻"
          label={video.boostsCount >= 1000 ? `${(video.boostsCount / 1000).toFixed(video.boostsCount % 1000 === 0 ? 0 : 1)}k` : `${video.boostsCount}`}
          onClick={() => onActionClick('boost', video.id)}
        />
        <ActionPill
          icon="⚡"
          label={video.zapsCount >= 1000 ? `${(video.zapsCount / 1000).toFixed(video.zapsCount % 1000 === 0 ? 0 : 1)}k` : `${video.zapsCount}`}
          labelColor="text-[#f7f7f8]"
          iconColor="text-[#f5b942]"
          onClick={() => onActionClick('zap', video.id)}
        />
        <ActionPill
          icon="↗"
          onClick={() => onActionClick('share', video.id)}
        />
      </div>

      <div className="absolute bottom-0 left-0 right-0 z-10 h-[230px] bg-[#09090b]/72 md:h-[100px] md:bg-transparent">
        <div className="absolute left-4 top-[48px] w-[278px] max-w-[calc(100%-96px)] space-y-[6px] leading-none md:bottom-[16px] md:left-[18px] md:top-auto md:w-[139px]">
          <p className="text-[15px] font-semibold text-[#f7f7f8]">
            {creatorLabel} {video.creator.isVerified ? '✓' : ''}
          </p>
          <div className="block w-full text-left text-[14px] font-normal text-[#f7f7f8]">
            <span className="block leading-[1.35]">
              {video.description || video.title}
            </span>
          </div>
          <p className="text-[12px] font-medium text-[#a78bfa]">
            {(video.hashtags || ['melbourne', 'nightwalk', 'nostr']).map((tag) => `#${tag}`).join('  ')}
          </p>
        </div>
      </div>
    </article>
  )
}
