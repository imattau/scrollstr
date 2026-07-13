import { useEffect, useMemo, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import { db, VideoShape, mergeCountersIntoShapes } from '../../nostr/cache'
import { useMuteList } from '../../nostr/useMuteList'
import { sortByInsertOrder } from './feedSort'
import type { VideoItemData } from './VideoFeedItem'

// Debounced version of useLiveQuery — batches rapid IndexedDB changes into a
// single state update, preventing feed flicker when many events arrive at once.
function useDebouncedLiveQuery<T>(
  querier: () => Promise<T>,
  deps: any[],
  delay = 200
): T | undefined {
  const [result, setResult] = useState<T>()
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mountedRef = useRef(true)
  const isFirstRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    const subscription = liveQuery(querier).subscribe({
      next: (value) => {
        if (isFirstRef.current) {
          isFirstRef.current = false
          if (mountedRef.current) setResult(value as T)
        } else {
          clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => {
            if (mountedRef.current) setResult(value as T)
          }, delay)
        }
      },
      error: (err) => {
        console.error('[Feed] Live query error:', err)
        if (mountedRef.current) setResult(undefined)
      },
    })

    return () => {
      mountedRef.current = false
      clearTimeout(timerRef.current)
      subscription.unsubscribe()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return result
}

const mapShapeToVideoItem = (shape: VideoShape): VideoItemData => ({
  id: shape.id,
  kind: shape.kind ?? 22,
  createdAt: shape.created_at,
  firstSeen: shape.firstSeen,
  insertOrder: shape.insertOrder,
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
  hasBoosted: shape.userState?.boosted || false,
  hasZapped: shape.userState?.zapped || false,
  music: 'Original Clip Audio',
  mediaStatus: shape.mediaStatus,
  contentWarning: shape.contentWarning,
  width: shape.width,
  height: shape.height,
  duration: shape.duration,
  size: shape.size,
  mimeType: shape.mimeType
})

interface UseFeedVideosInput {
  sessionPubkey?: string
  feedType: string
  followingPubkeys: string[]
  mutedPubkeys: Set<string>
  mutedHashtags: Set<string>
  filterTag: string | null
  refreshKey: number
}

interface UseFeedVideosOutput {
  videos: VideoItemData[]
  isFeedLoading: boolean
  feedKey: string
  videosRef: React.MutableRefObject<VideoItemData[]>
}

export function useFeedVideos(input: UseFeedVideosInput): UseFeedVideosOutput {
  const { sessionPubkey, feedType, followingPubkeys, mutedPubkeys, mutedHashtags, filterTag, refreshKey } = input

  const [isFeedLoading, setIsFeedLoading] = useState(true)

  const _allShapes = useDebouncedLiveQuery(async () => {
    try {
      const shapes = await db.videoShapes.where('mediaStatus').notEqual('failed').toArray()
      return await mergeCountersIntoShapes(shapes)
    } catch (err) {
      console.error('[VideoFeed] Error in video query:', err)
      return []
    }
  }, [refreshKey], 200)

  const allShapes = useMemo(() => _allShapes ?? [], [_allShapes])

  const _followedShapes = useDebouncedLiveQuery(async () => {
    if (!sessionPubkey || followingPubkeys.length === 0) return []
    try {
      const shapes = await db.videoShapes
        .where('pubkey').anyOf(followingPubkeys)
        .filter(shape => shape.mediaStatus !== 'failed')
        .toArray()
      return await mergeCountersIntoShapes(shapes)
    } catch (err) {
      console.error('[VideoFeed] Error in following video query:', err)
      return []
    }
  }, [sessionPubkey, followingPubkeys, refreshKey], 200)

  const followedShapes = useMemo(() => _followedShapes ?? [], [_followedShapes])

  const filterVideos = (source: VideoShape[]) => {
    let list = source.map(mapShapeToVideoItem)

    if (mutedPubkeys.size > 0) {
      list = list.filter((v: VideoItemData) => !mutedPubkeys.has(v.creator.pubkey))
    }

    if (filterTag) {
      list = list.filter((v: VideoItemData) =>
        v.hashtags?.some((t: string) => t.toLowerCase() === filterTag.toLowerCase())
      )
    }

    if (mutedHashtags.size > 0) {
      list = list.filter((v: VideoItemData) =>
        !v.hashtags?.some((t: string) => mutedHashtags.has(t.toLowerCase()))
      )
    }

    return [...list].sort(sortByInsertOrder)
  }

  const exploreVideos = useMemo(() => filterVideos(allShapes), [allShapes, filterTag, mutedPubkeys, mutedHashtags])
  const followingVideos = useMemo(() => filterVideos(followedShapes), [followedShapes, filterTag, mutedPubkeys, mutedHashtags])
  const videos = feedType === 'following' && sessionPubkey ? followingVideos : exploreVideos

  const videosRef = useRef(videos)
  useEffect(() => { videosRef.current = videos }, [videos])

  const feedKey = useMemo(
    () => videos.length === 0 ? '' : `${videos.length}:${videos[0]?.id}:${videos[videos.length - 1]?.id}`,
    [videos]
  )

  return { videos, isFeedLoading, feedKey, videosRef }
}
