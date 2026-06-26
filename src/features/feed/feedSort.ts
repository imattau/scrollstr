import { VideoItemData } from './VideoFeedItem'

const LOCAL_PREVIEW_ID = 'deadbeef00000000000000000000000000000000000000000000000000000000001'

export function sortByInsertOrder(a: VideoItemData, b: VideoItemData): number {
  if (a.id === LOCAL_PREVIEW_ID) return -1
  if (b.id === LOCAL_PREVIEW_ID) return 1
  return (a.insertOrder ?? 0) - (b.insertOrder ?? 0)
}
