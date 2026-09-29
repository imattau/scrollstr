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
 *
 * `items` is not the full picture of "what's still valid" — it's whatever
 * batch the current query happened to return (e.g. only *unwatched*
 * videos), so an already-shown id can legitimately be absent from it
 * without meaning the item was deleted. `isStillValid`, when given, is
 * consulted for exactly that case: an id already in `prevOrder` but missing
 * from this batch. Retention is that way decoupled from query-batch
 * membership entirely — only a `false` from `isStillValid` (or its absence)
 * drops an item.
 */
/**
 * Prepend items that are strictly older than everything already shown.
 * Used when the user scrolls back toward the start of the session's stable
 * order and a backward backfill fetch turns up history from before it —
 * unlike `appendNewItems`, these are placed *before* `prevOrder` rather than
 * after, since they belong earlier in time than anything currently loaded.
 * Already-known ids are filtered out so this stays safe to call with a
 * batch that overlaps `prevOrder`.
 */
export function prependOlderItems<T extends { id: string }>(
  prevOrder: string[],
  olderItems: T[],
  sortNew: (a: T, b: T) => number
): string[] {
  const known = new Set(prevOrder)
  const fresh = olderItems.filter((v) => !known.has(v.id)).sort(sortNew)
  if (fresh.length === 0) return prevOrder
  return [...fresh.map((v) => v.id), ...prevOrder]
}

export function appendNewItems<T extends { id: string }>(
  prevOrder: string[],
  items: T[],
  sortNew: (a: T, b: T) => number,
  isStillValid?: (id: string) => boolean
): string[] {
  const byId = new Map(items.map((v) => [v.id, v]))
  const retained = prevOrder.filter((id) => byId.has(id) || (isStillValid?.(id) ?? false))
  const retainedSet = new Set(retained)
  const fresh = items.filter((v) => !retainedSet.has(v.id)).sort(sortNew)
  return [...retained, ...fresh.map((v) => v.id)]
}
