import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { graph, useGraphQuery } from '../../graph'
import type { NodeType, PolyNode } from '../../graph'
import { VideoShape, mergeCountersIntoShapes } from '../../nostr/cache'
import { useMuteList } from '../../nostr/useMuteList'
import { sortByInsertOrder, appendNewItems } from './feedSort'
import type { VideoItemData } from './VideoFeedItem'

/**
 * Session-stable, append-only ordering: once an item is showing, it never
 * moves — new items (newer live content or older backfilled content alike)
 * are sorted among themselves and appended at the end. Resets (starting
 * fresh, newest-first) whenever `resetKey` changes, e.g. on manual refresh.
 */
function useStableFeedOrder(items: VideoItemData[], resetKey: string): VideoItemData[] {
  const orderRef = useRef<string[]>([])
  const prevResetKeyRef = useRef(resetKey)

  return useMemo(() => {
    if (resetKey !== prevResetKeyRef.current) {
      prevResetKeyRef.current = resetKey
      orderRef.current = []
    }
    const byId = new Map(items.map((v) => [v.id, v]))
    orderRef.current = appendNewItems(orderRef.current, items, sortByInsertOrder)
    return orderRef.current.map((id) => byId.get(id)).filter((v): v is VideoItemData => !!v)
  }, [items, resetKey])
}

const FEED_QUERY_LIMIT = 200

const mapShapeToVideoItem = (shape: VideoShape): VideoItemData => ({
  id: shape.id,
  kind: shape.kind ?? 22,
  createdAt: shape.created_at,
  firstSeen: shape.firstSeen,
  insertOrder: shape.insertOrder,
  title: shape.title ?? '',
  description: shape.summary ?? '',
  url: shape.videoUrl ?? '',
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
  deeplinkVideoId?: string | null
}

interface UseFeedVideosOutput {
  videos: VideoItemData[]
  isFeedLoading: boolean
  feedKey: string
  videosRef: React.MutableRefObject<VideoItemData[]>
}

export function useFeedVideos(input: UseFeedVideosInput): UseFeedVideosOutput {
  const { sessionPubkey, feedType, followingPubkeys, mutedPubkeys, mutedHashtags, filterTag, refreshKey, deeplinkVideoId } = input

  const [isFeedLoading, setIsFeedLoading] = useState(true)

  const _allShapes = useGraphQuery(async () => {
    try {
      let shapes: VideoShape[]
      if (filterTag) {
        const nodes = graph.whereType('video_shape')
          .filter(n => {
            const tags = (n.data.hashtags as string[]) ?? []
            return tags.some(t => t.toLowerCase() === filterTag.toLowerCase())
          })
          .sort((a, b) => ((b.data.insertOrder as number) ?? 0) - ((a.data.insertOrder as number) ?? 0))
          .slice(0, FEED_QUERY_LIMIT)
        shapes = nodes.map(n => n.data as unknown as VideoShape)
      } else {
        const nodes = graph.recentBy('insertOrder', FEED_QUERY_LIMIT, 'video_shape')
        shapes = nodes.map(n => n.data as unknown as VideoShape)
      }
      const valid = shapes.filter(s => s.videoUrl && s.mediaStatus !== 'failed' && !s.hidden)
      return await mergeCountersIntoShapes(valid)
    } catch (err) {
      console.error('[VideoFeed] Error in video query:', err)
      return []
    }
  }, [refreshKey, filterTag], 500, ['video_shape'])

  const allShapes = useMemo(() => _allShapes ?? [], [_allShapes])

  const _followedShapes = useGraphQuery(async () => {
    if (!sessionPubkey || followingPubkeys.length === 0) return []
    try {
      const allNodes: PolyNode[] = []
      for (const pk of followingPubkeys) {
        for (const n of graph.byPubkey(pk, 'video_shape')) allNodes.push(n)
      }
      let shapes = allNodes.map(n => n.data as unknown as VideoShape)
        .filter(s => s.videoUrl && s.mediaStatus !== 'failed' && !s.hidden)
      if (filterTag) {
        shapes = shapes.filter(s =>
          s.hashtags?.some(t => t.toLowerCase() === filterTag.toLowerCase())
        )
      }
      shapes.sort((a, b) => (b.insertOrder ?? 0) - (a.insertOrder ?? 0))
      shapes = shapes.slice(0, FEED_QUERY_LIMIT)
      return await mergeCountersIntoShapes(shapes)
    } catch (err) {
      console.error('[VideoFeed] Error in following video query:', err)
      return []
    }
  }, [sessionPubkey, followingPubkeys, refreshKey, filterTag], 500, ['video_shape'])

  const followedShapes = useMemo(() => _followedShapes ?? [], [_followedShapes])

  // Deep-linked videos (from Profile/Discover) are frequently older than the
  // FEED_QUERY_LIMIT window above, so they'd never surface via insertOrder
  // ranking. Look the target up directly by node id, bypassing that window —
  // getNodeSafe falls back to the graph's IndexedDB persistence for nodes
  // evicted from the in-memory hot cache.
  const _deeplinkShape = useGraphQuery(async () => {
    if (!deeplinkVideoId) return undefined
    try {
      const node = await graph.getNodeSafe(deeplinkVideoId)
      if (!node || node.type !== 'video_shape') return undefined
      const shape = node.data as unknown as VideoShape
      if (!shape.videoUrl || shape.mediaStatus === 'failed' || shape.hidden) return undefined
      const [withCounters] = await mergeCountersIntoShapes([shape])
      return withCounters
    } catch (err) {
      console.error('[VideoFeed] Error fetching deep-linked video shape:', err)
      return undefined
    }
  }, [deeplinkVideoId], 200, ['video_shape'])

  const injectDeeplink = useCallback((list: VideoItemData[]) => {
    if (!deeplinkVideoId || !_deeplinkShape) return list
    if (list.some(v => v.id === deeplinkVideoId)) return list
    return [mapShapeToVideoItem(_deeplinkShape), ...list]
  }, [deeplinkVideoId, _deeplinkShape])

  const filterVideos = useCallback((source: VideoShape[]) => {
    let list = source.map(mapShapeToVideoItem)

    if (mutedPubkeys.size > 0) {
      list = list.filter((v: VideoItemData) => !mutedPubkeys.has(v.creator.pubkey))
    }

    if (mutedHashtags.size > 0) {
      list = list.filter((v: VideoItemData) =>
        !v.hashtags?.some((t: string) => mutedHashtags.has(t.toLowerCase()))
      )
    }

    return [...list].sort(sortByInsertOrder)
  }, [mutedPubkeys, mutedHashtags])

  const exploreVideosRaw = useMemo(
    () => injectDeeplink(filterVideos(allShapes)),
    [allShapes, filterVideos, injectDeeplink]
  )
  const followingVideosRaw = useMemo(
    () => injectDeeplink(filterVideos(followedShapes)),
    [followedShapes, filterVideos, injectDeeplink]
  )
  const exploreVideos = useStableFeedOrder(exploreVideosRaw, `explore:${refreshKey}:${filterTag ?? ''}`)
  const followingVideos = useStableFeedOrder(
    followingVideosRaw,
    `following:${sessionPubkey ?? ''}:${refreshKey}:${filterTag ?? ''}`
  )
  const videos = feedType === 'following' && sessionPubkey ? followingVideos : exploreVideos

  const videosRef = useRef(videos)
  useEffect(() => { videosRef.current = videos }, [videos])

  const feedKey = useMemo(
    () => videos.length === 0 ? '' : `${videos.length}:${videos[0]?.id}:${videos[videos.length - 1]?.id}`,
    [videos]
  )

  return { videos, isFeedLoading, feedKey, videosRef }
}
