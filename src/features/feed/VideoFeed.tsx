import React, { useEffect, useRef, useState, useCallback, useLayoutEffect, useMemo } from 'react'
import { MediaStack } from 'react-media-stack'
import type { MediaItemData, MediaStackRef } from 'react-media-stack'
import { VideoItemData } from './VideoFeedItem'
import { useNostr } from '../../app/providers'
import { useUserRelayUrls } from '../../nostr/relays'
import { useLiveQuery } from '../../graph'
import { db } from '../../nostr/cache'
import { useMuteList } from '../../nostr/useMuteList'
import { subscribeToRelays, setIndexWritesDeferred, flushIndexWrites } from '../../nostr/pool'
import { useFeedVideos } from './useFeedVideos'
import { useFeedPosition } from './useFeedPosition'
import { useFeedSubscriptions } from './useFeedSubscriptions'
import { loadSettings } from '../../db/local-preferences'
import { useProfile } from '../../nostr/profile'


import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { ArrowUp, Sparkles, AlertTriangle, SkipForward } from 'lucide-react'

interface VideoFeedProps {
  onActionTrigger: (actionType: string, videoId: string, creatorPubkey?: string, videoKind?: number) => void
  onVideoChange?: (video: VideoItemData) => void
  isMuted: boolean
}

export const VideoFeed = React.memo<VideoFeedProps>(({ onActionTrigger, onVideoChange, isMuted }) => {
  const { session } = useNostr()
  const [searchParams] = useSearchParams()
  const filterTag = searchParams.get('tag')
  const initialVideoId = searchParams.get('v')
  const feedType = searchParams.get('feed') || 'explore'

  const [activeIndex, setActiveIndex] = useState(0)
  const mediaStackRef = useRef<MediaStackRef>(null)
  const activeIndexRef = useRef(activeIndex)
  useEffect(() => { activeIndexRef.current = activeIndex }, [activeIndex])

  // Defer index writes while scrolling — when activeIndex changes frequently,
  // events accumulate in a pending batch instead of being written to IndexedDB.
  // Once the index is stable for SCROLL_SETTLE_MS, pending events are flushed.
  // This prevents feed flicker and video resets during rapid scrolling.
  const prevScrollIdxRef = useRef(activeIndex)
  useEffect(() => {
    if (prevScrollIdxRef.current !== activeIndex) {
      prevScrollIdxRef.current = activeIndex
      setIndexWritesDeferred(true)

      const timer = setTimeout(() => {
        setIndexWritesDeferred(false)
      }, 1500)

      return () => clearTimeout(timer)
    }
  }, [activeIndex])

  // Flush any pending index writes when the component unmounts
  useEffect(() => {
    return () => {
      setIndexWritesDeferred(false)
    }
  }, [])

  const [uiHidden, setUiHidden] = useState(false)
  const [refreshKey] = useState(0)

  const relayUrls = useUserRelayUrls(session?.pubkey)

  // Load settings once (not on every render) to avoid blocking on localStorage reads
  const settingsRef = useRef(loadSettings())
  useEffect(() => {
    settingsRef.current = loadSettings()
  }, [])

  // Reactively query the user's kind:3 contact list from Dexie cache
  const contactListEvents = useLiveQuery(
    () => session?.pubkey
      ? db.cachedEvents.where({ kind: 3, pubkey: session.pubkey }).toArray()
      : Promise.resolve([] as any[]),
    [session?.pubkey ?? '']
  ) ?? []

  const contactListEvent = contactListEvents.toSorted((a, b) => b.created_at - a.created_at)[0]?.event

  const followingPubkeys = useMemo(() => {
    if (!contactListEvent) return []
    return contactListEvent.tags.filter((t: any) => t[0] === 'p').map((t: any) => t[1])
  }, [contactListEvent])

  const { mutedPubkeys, mutedHashtags } = useMuteList(session?.pubkey)

  // Feed data: videos, filtering, sorting
  const { videos, feedKey, videosRef } = useFeedVideos({
    sessionPubkey: session?.pubkey,
    feedType,
    followingPubkeys,
    mutedPubkeys,
    mutedHashtags,
    filterTag,
    refreshKey,
  })

  // Feed position: deep link, sessionStorage, initial scroll position
  const {
    deeplinkFailed,
    deeplinkPending,
    activeVideoIdRef,
  } = useFeedPosition({
    initialVideoId,
    feedType,
    filterTag,
    videos,
    activeIndex,
    setActiveIndex,
  })

  // Derive active video ID from the ref-tracked ID rather than stale activeIndex,
  // so the playing video stays active when new videos are prepended and indices shift.
  const activeVideoId = useMemo(() => {
    const id = activeVideoIdRef.current
    if (id && videos.some(v => v.id === id)) return id
    return videos[activeIndex]?.id
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos, activeIndex])

  // Derive the effective active index from activeVideoId so isNearActive stays
  // consistent with isActive even when indices shift due to prepended videos.
  const activeIdxForNear = useMemo(
    () => videos.findIndex(v => v.id === activeVideoId),
    [videos, activeVideoId]
  )

  // Subscriptions: relays, backfills, load-more
  const oldestCreatedAt = videos[videos.length - 1]?.createdAt
  useFeedSubscriptions({
    relayUrls,
    sessionPubkey: session?.pubkey,
    followingPubkeys,
    mutedPubkeys,
    activeIndex,
    videosLength: videos.length,
    oldestCreatedAt,
    refreshKey,
  })

  // Subscribe for the deeplink video if not already in the feed — needed because
  // the general feed subscription only covers the last 30 days, missing older events.
  useEffect(() => {
    if (!initialVideoId) return
    if (videos.some(v => v.id === initialVideoId)) return
    if (relayUrls.length === 0) return

    const unsub = subscribeToRelays(relayUrls, {
      kinds: [1, 21, 22, 34236],
      ids: [initialVideoId],
    })
    return () => unsub()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialVideoId, relayUrls])

  // Progressive comments & zaps subscription for videos near the viewport
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

  // New-events counter
  const [newEventsCount, setNewEventsCount] = useState(0)
  const seenVideoIdsRef = useRef<Set<string>>(new Set())

  useLayoutEffect(() => {
    if (videos.length === 0) return

    if (seenVideoIdsRef.current.size === 0) {
      seenVideoIdsRef.current = new Set(videos.map(v => v.id))
      return
    }

    if (activeIndexRef.current <= 0) {
      seenVideoIdsRef.current = new Set(videos.map(v => v.id))
      setNewEventsCount(0)
      return
    }

    const unseen = videos.filter(v => !seenVideoIdsRef.current.has(v.id)).length
    if (unseen > 0) {
      setNewEventsCount(unseen)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos.length])

  const scrollToNewest = useCallback(() => {
    flushIndexWrites()
    const currentVideos = videosRef.current
    if (currentVideos.length === 0) return
    mediaStackRef.current?.scrollTo('start')
    setActiveIndex(0)
    setNewEventsCount(0)
    seenVideoIdsRef.current = new Set(currentVideos.map(v => v.id))
  }, [videosRef])

  const handleActiveIndexChange = useCallback((index: number) => {
    setActiveIndex(index)
    const video = videosRef.current[index]
    if (onVideoChange && video) {
      onVideoChange(video)
    }
  }, [onVideoChange, videosRef])

  // Fetch profile for active video — triggers kind:0 relay subscription which
  // updates videoShapes with authorName/authorPicture, flowing into mediaItems.
  const activeVideo = videos[activeIndex]
  useProfile(activeVideo?.creator.pubkey || '')

  // Derive active video for error overlay
  const activeVideoError = useMemo(() => {
    if (!activeVideo) return null
    const s = activeVideo.mediaStatus
    if (s === 'failed') return { title: 'Failed to load', message: 'This video could not be loaded from the server.' }
    if (s === 'too_large') return { title: 'Video too large', message: 'This video exceeds the maximum file size.' }
    if (s === 'unsupported') return { title: 'Unsupported format', message: 'Your browser does not support this video format.' }
    return null
  }, [activeVideo])

  // Map videos to MediaItemData
  const mediaItems: MediaItemData[] = useMemo(
    () => videos.map(v => ({
      id: v.id,
      type: 'video' as const,
      src: v.url,
      poster: v.poster,
      title: v.title,
      description: v.description,
      badge: v.contentWarning,
      authorName: v.creator.name,
      authorAvatarUrl: v.creator.picture,
      authorVerified: v.creator.isVerified,
      nsfw: !!(settingsRef.current.nsfwBlur && (v.contentWarning || settingsRef.current.nsfwPubkeys?.includes(v.creator.pubkey))),
      customData: v,
    })),
    [videos, settingsRef.current.nsfwBlur, settingsRef.current.nsfwPubkeys]
  )

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

  if (deeplinkPending) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-[#09090b] md:h-full">
        <div className="flex flex-col items-center gap-3">
          {deeplinkFailed ? (
            <>
              <p className="text-[14px] text-[#a1a1aa]">Video not found</p>
              <p className="text-[12px] text-[#71717a]">The video could not be loaded from relays.</p>
            </>
          ) : (
            <>
              <div className="size-8 animate-spin rounded-full border-2 border-[#27272a] border-t-[#8b5cf6]" />
              <p className="text-[14px] text-[#a1a1aa]">Finding video...</p>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-full relative overflow-hidden">
      {/* Feed type toggles — positioned inline with MediaStack overlay */}
      <div className="absolute top-0 left-0 right-0 z-40 pointer-events-auto">
        <div className="flex gap-1.5 pt-3 px-4">
          <Link
            to="/?feed=following"
            className={`rounded-[16px] px-3 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap ${
              feedType === 'following'
                ? 'bg-purple-500 text-white'
                : 'bg-black/40 text-neutral-300 backdrop-blur-sm border border-white/10 hover:bg-black/60'
            }`}
          >
            Following
          </Link>
          <Link
            to="/?feed=explore"
            className={`rounded-[16px] px-3 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap ${
              feedType === 'explore'
                ? 'bg-purple-500 text-white'
                : 'bg-black/40 text-neutral-300 backdrop-blur-sm border border-white/10 hover:bg-black/60'
            }`}
          >
            Explore
          </Link>
        </div>
      </div>

      <MediaStack
        ref={mediaStackRef}
        items={mediaItems}
        direction="vertical"
        autoPlay
        muted={isMuted}
        loop={!settingsRef.current.autoScroll}
        hideScrollbar
        showNavArrows={false}
        showProgressBar
        showMuteButton={false}
        showSidebarActions
        showMetaInfo
        autoRotateLandscape={settingsRef.current.autoRotateLandscape}
        showDevHud={false}
        onActiveIndexChange={handleActiveIndexChange}
        onLikeClick={(item) => {
          const v = item.customData as VideoItemData
          onActionTrigger('like', v.id, v.creator.pubkey, v.kind)
        }}
        onCommentClick={(item) => {
          const v = item.customData as VideoItemData
          onActionTrigger('comment', v.id, v.creator.pubkey, v.kind)
        }}
        onShareClick={(item) => {
          const v = item.customData as VideoItemData
          onActionTrigger('share', v.id)
        }}
        onAuthorClick={(item: MediaItemData) => {
          const v = item.customData as VideoItemData
          window.location.href = `/profile/${v.creator.pubkey}`
        }}

        renderLikeButton={(isActive, onClick) => {
          const v = videos[activeIndex] as VideoItemData | undefined
          return (
            <button type="button" className="media-stack-icon-btn rvf:pointer-events-auto" onClick={onClick} aria-label="Like">
              <svg width="20" height="20" viewBox="0 0 24 24" fill={v?.hasLiked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
            </button>
          )
        }}
        renderCommentButton={(onClick) => {
          return (
            <button type="button" className="media-stack-icon-btn rvf:pointer-events-auto" onClick={onClick} aria-label="Comment">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
          )
        }}
        renderShareButton={(onClick) => {
          return (
            <button type="button" className="media-stack-icon-btn rvf:pointer-events-auto" onClick={onClick} aria-label="Share">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
            </button>
          )
        }}
        renderExtraActions={(item, index) => {
          const v = item.customData as VideoItemData
          return (
            <>
              <div className="media-stack-action-item">
                <button type="button" className="media-stack-icon-btn rvf:pointer-events-auto" aria-label="Boost"
                  onClick={(e) => { e.stopPropagation(); onActionTrigger('boost', v.id, v.creator.pubkey, v.kind) }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill={v.hasBoosted ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                    <path d="M17 1l4 4-4 4M7 23l-4-4 4-4M7 5l10 14"/>
                  </svg>
                </button>
                {v.boostsCount > 0 && <span className="media-stack-action-count">{v.boostsCount >= 1000 ? `${(v.boostsCount / 1000).toFixed(v.boostsCount % 1000 === 0 ? 0 : 1)}k` : v.boostsCount}</span>}
              </div>
              <div className="media-stack-action-item">
                <button type="button" className="media-stack-icon-btn rvf:pointer-events-auto" aria-label="Zap"
                  onClick={(e) => { e.stopPropagation(); onActionTrigger('zap', v.id, v.creator.pubkey, v.kind) }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f5b942" strokeWidth="2">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                  </svg>
                </button>
                {v.zapsCount > 0 && <span className="media-stack-action-count">{v.zapsCount >= 1000 ? `${(v.zapsCount / 1000).toFixed(v.zapsCount % 1000 === 0 ? 0 : 1)}k` : v.zapsCount}</span>}
              </div>
              <div className="media-stack-action-item">
                <button type="button" className="media-stack-icon-btn rvf:pointer-events-auto" aria-label={isMuted ? 'Unmute' : 'Mute'}
                  onClick={(e) => { e.stopPropagation(); onActionTrigger('mute', v.id) }}>
                  {isMuted ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                      <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
                    </svg>
                  )}
                </button>
              </div>
            </>
          )
        }}
      />

      {/* Error overlay for active video */}
      {activeVideoError && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 pointer-events-none">
          <AlertTriangle className="w-10 h-10 text-[#a1a1aa]" />
          <span className="text-[15px] font-semibold text-[#f7f7f8]">{activeVideoError.title}</span>
          <span className="text-[12px] text-[#a1a1aa] text-center px-8">{activeVideoError.message}</span>
          <span className="flex items-center gap-1 mt-1 text-[11px] text-[#71717a]">
            <SkipForward className="w-3 h-3" />
            Scroll past to continue
          </span>
        </div>
      )}

      {newEventsCount > 0 && activeIndex > 0 && !uiHidden && (
        <button
          onClick={scrollToNewest}
          className="new-events-pill"
          title={`${newEventsCount} new video${newEventsCount === 1 ? '' : 's'} — tap to go to newest`}
        >
          <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{newEventsCount} new</span>
          <ArrowUp className="w-3.5 h-3.5 flex-shrink-0" />
        </button>
      )}


    </div>
  )
})
