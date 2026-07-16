import { VideoItemData } from './VideoFeedItem'

const LOCAL_PREVIEW_ID = 'deadbeef00000000000000000000000000000000000000000000000000000000001'

export function sortByInsertOrder(a: VideoItemData, b: VideoItemData): number {
  if (a.id === LOCAL_PREVIEW_ID) return -1
  if (b.id === LOCAL_PREVIEW_ID) return 1
  return (b.insertOrder ?? 0) - (a.insertOrder ?? 0)
}

/**
 * Merge freshly-queried items into a session-stable, append-only order:
 * items already in `prevOrder` keep their position (so nothing already on
 * screen ever moves and scroll position never needs correcting), and any
 * newly-discovered ids — whether brand new live content or older backfilled
 * content — are sorted among themselves and appended at the end.
 */
export function appendNewItems<T extends { id: string }>(
  prevOrder: string[],
  items: T[],
  sortNew: (a: T, b: T) => number
): string[] {
  const byId = new Map(items.map((v) => [v.id, v]))
  const retained = prevOrder.filter((id) => byId.has(id))
  const retainedSet = new Set(retained)
  const fresh = items.filter((v) => !retainedSet.has(v.id)).sort(sortNew)
  return [...retained, ...fresh.map((v) => v.id)]
}
