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
 *
 * `items` is only ever a *batch* — the feed query below returns unwatched
 * videos, so an already-shown id legitimately drops out of it once the
 * user watches it, without meaning it was deleted. Retention of
 * already-shown ids is decoupled from batch membership: an id missing from
 * `items` is kept (using its last-known data) as long as `isStillVisible`
 * says so, and only actually dropped for a real reason (deleted, hidden,
 * newly muted).
 */
function useStableFeedOrder(
  items: VideoItemData[],
  resetKey: string,
  isStillVisible: (id: string) => boolean
): VideoItemData[] {
  const orderRef = useRef<string[]>([])
  const dataRef = useRef<Map<string, VideoItemData>>(new Map())
  const prevResetKeyRef = useRef(resetKey)

  return useMemo(() => {
    if (resetKey !== prevResetKeyRef.current) {
      prevResetKeyRef.current = resetKey
      orderRef.current = []
      dataRef.current = new Map()
    }

    for (const v of items) dataRef.current.set(v.id, v)

    orderRef.current = appendNewItems(
      orderRef.current,
      items,
      sortByInsertOrder,
      (id) => dataRef.current.has(id) && isStillVisible(id)
    )

    const orderSet = new Set(orderRef.current)
    for (const id of dataRef.current.keys()) {
      if (!orderSet.has(id)) dataRef.current.delete(id)
    }

    return orderRef.current.map((id) => dataRef.current.get(id)).filter((v): v is VideoItemData => !!v)
  }, [items, resetKey, isStillVisible])
}

// A generous, fixed cap on how many *unwatched* candidates the query
// considers per page — no longer a correctness bound (retention above
// doesn't depend on it), just a sanity limit on per-query work. As the user
// watches through the current page, those ids drop out of the "unwatched"
// filter, and the query naturally surfaces the next page of unwatched
// content on its own — a moving window driven by watched status rather
// than an arbitrary rank cutoff or ever-growing scroll-depth window.
const FEED_QUERY_LIMIT = 300

export function isUnwatched(data: Record<string, unknown>): boolean {
  return !(data.userState as { watched?: boolean } | undefined)?.watched
}

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
            return tags.some(t => t.toLowerCase() === filterTag.toLowerCase()) && isUnwatched(n.data)
          })
          .sort((a, b) => ((b.data.insertOrder as number) ?? 0) - ((a.data.insertOrder as number) ?? 0))
          .slice(0, FEED_QUERY_LIMIT)
        shapes = nodes.map(n => n.data as unknown as VideoShape)
      } else {
        const nodes = graph.whereType('video_shape')
          .filter(n => isUnwatched(n.data))
          .sort((a, b) => ((b.data.insertOrder as number) ?? 0) - ((a.data.insertOrder as number) ?? 0))
          .slice(0, FEED_QUERY_LIMIT)
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
      let shapes = allNodes
        .filter(n => isUnwatched(n.data))
        .map(n => n.data as unknown as VideoShape)
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

  // Deep-linked videos (from Profile/Discover) are frequently already
  // watched or outside the unwatched-window query above, so they'd never
  // surface via the queries above. Look the target up directly by node id
  // instead — getNodeSafe falls back to the graph's IndexedDB persistence
  // for nodes evicted from the in-memory hot cache.
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

  // Direct existence/visibility check for an already-shown id that's absent
  // from the latest (unwatched-only) query batch — used by useStableFeedOrder
  // to tell "watched, still valid" apart from "actually deleted/hidden/muted".
  const isStillVisible = useCallback((id: string): boolean => {
    const node = graph.getNode(`shp:${id}`)
    if (!node) return false
    const data = node.data as Record<string, unknown>
    if (data.hidden || data.mediaStatus === 'failed') return false
    const pubkey = data.pubkey as string | undefined
    if (pubkey && mutedPubkeys.has(pubkey)) return false
    const hashtags = (data.hashtags as string[] | undefined) ?? []
    if (hashtags.some((t) => mutedHashtags.has(t.toLowerCase()))) return false
    return true
  }, [mutedPubkeys, mutedHashtags])

  const exploreVideosRaw = useMemo(
    () => injectDeeplink(filterVideos(allShapes)),
    [allShapes, filterVideos, injectDeeplink]
  )
  const followingVideosRaw = useMemo(
    () => injectDeeplink(filterVideos(followedShapes)),
    [followedShapes, filterVideos, injectDeeplink]
  )
  const exploreVideos = useStableFeedOrder(exploreVideosRaw, `explore:${refreshKey}:${filterTag ?? ''}`, isStillVisible)
  const followingVideos = useStableFeedOrder(
    followingVideosRaw,
    `following:${sessionPubkey ?? ''}:${refreshKey}:${filterTag ?? ''}`,
    isStillVisible
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
