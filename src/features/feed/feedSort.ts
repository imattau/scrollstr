import { VideoItemData } from './VideoFeedItem'

const LOCAL_PREVIEW_ID = 'deadbeef00000000000000000000000000000000000000000000000000000000001'

export function sortByFirstSeen(a: VideoItemData, b: VideoItemData): number {
  if (a.id === LOCAL_PREVIEW_ID) return -1
  if (b.id === LOCAL_PREVIEW_ID) return 1
  const createdAtDiff = (b.createdAt ?? 0) - (a.createdAt ?? 0)
  if (createdAtDiff !== 0) return createdAtDiff
  return (b.firstSeen ?? 0) - (a.firstSeen ?? 0)
}
