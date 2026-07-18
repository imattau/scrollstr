import { useEffect, useState, useRef } from 'react'
import { findSimilarVideos } from '../../graph'
import type { VideoShape } from '../../nostr/cache'
import type { VideoItemData } from '../feed/VideoFeedItem'

function shapeToItem(shape: VideoShape): VideoItemData {
  return {
    id: shape.id,
    kind: shape.kind ?? 22,
    createdAt: shape.created_at,
    title: shape.title ?? '',
    description: shape.summary ?? '',
    url: shape.videoUrl ?? '',
    poster: shape.thumbnailUrl,
    creator: {
      pubkey: shape.pubkey,
      name: shape.authorName || shape.pubkey.slice(0, 8),
      picture: shape.authorPicture,
    },
    hashtags: shape.hashtags ?? [],
    likesCount: shape.reactionCount ?? 0,
    commentsCount: shape.replyCount ?? 0,
    boostsCount: shape.repostCount ?? 0,
    zapsCount: shape.zapCount ?? 0,
    mediaStatus: shape.mediaStatus,
    contentWarning: shape.contentWarning,
    width: shape.width,
    height: shape.height,
    duration: shape.duration,
    mimeType: shape.mimeType,
  }
}

export function useSimilarVideos(
  videoId: string | undefined,
  topK = 10,
  threshold = 0.3
): VideoItemData[] {
  const [videos, setVideos] = useState<VideoItemData[]>([])
  const lastIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!videoId || videoId === lastIdRef.current) return
    lastIdRef.current = videoId

    let cancelled = false
    findSimilarVideos(videoId, topK, threshold).then((shapes) => {
      if (cancelled) return
      setVideos(shapes.map(shapeToItem))
    })
    return () => { cancelled = true }
  }, [videoId, topK, threshold])

  return videos
}
