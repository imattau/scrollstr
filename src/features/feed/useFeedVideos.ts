import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { graph, useGraphQuery } from '../../graph'
import type { NodeType, PolyNode } from '../../graph'
import { VideoShape, mergeCountersIntoShapes } from '../../nostr/cache'
import { useMuteList } from '../../nostr/useMuteList'
import { sortByInsertOrder } from './feedSort'
import type { VideoItemData } from './VideoFeedItem'

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

  const exploreVideos = useMemo(() => filterVideos(allShapes), [allShapes, filterVideos])
  const followingVideos = useMemo(() => filterVideos(followedShapes), [followedShapes, filterVideos])
  const videos = feedType === 'following' && sessionPubkey ? followingVideos : exploreVideos

  const videosRef = useRef(videos)
  useEffect(() => { videosRef.current = videos }, [videos])

  const feedKey = useMemo(
    () => videos.length === 0 ? '' : `${videos.length}:${videos[0]?.id}:${videos[videos.length - 1]?.id}`,
    [videos]
  )

  return { videos, isFeedLoading, feedKey, videosRef }
}
