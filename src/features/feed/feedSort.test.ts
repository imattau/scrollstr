import { describe, it, expect } from 'vitest'
import { sortByInsertOrder, appendNewItems } from './feedSort'
import type { VideoItemData } from './VideoFeedItem'

function makeVideo(overrides: Partial<VideoItemData> & { id: string }): VideoItemData {
  return {
    url: '',
    creator: { pubkey: 'abc', name: 'test' },
    likesCount: 0,
    commentsCount: 0,
    boostsCount: 0,
    zapsCount: 0,
    ...overrides,
  }
}

const LOCAL_PREVIEW_ID = 'deadbeef00000000000000000000000000000000000000000000000000000000001'

describe('sortByInsertOrder', () => {
  it('sorts by insertOrder descending (newest first)', () => {
    const videos = [
      makeVideo({ id: 'a', insertOrder: 100 }),
      makeVideo({ id: 'b', insertOrder: 300 }),
      makeVideo({ id: 'c', insertOrder: 200 }),
    ]
    videos.sort(sortByInsertOrder)
    expect(videos.map(v => v.id)).toEqual(['b', 'c', 'a'])
  })

  it('puts LOCAL_PREVIEW_ID first regardless of insertOrder', () => {
    const videos = [
      makeVideo({ id: 'a', insertOrder: 500 }),
      makeVideo({ id: LOCAL_PREVIEW_ID, insertOrder: 100 }),
      makeVideo({ id: 'b', insertOrder: 400 }),
    ]
    videos.sort(sortByInsertOrder)
    expect(videos[0].id).toBe(LOCAL_PREVIEW_ID)
  })

  it('treats undefined insertOrder as 0 (sorted after non-zero)', () => {
    const videos = [
      makeVideo({ id: 'a', insertOrder: undefined }),
      makeVideo({ id: 'b', insertOrder: 100 }),
    ]
    videos.sort(sortByInsertOrder)
    expect(videos.map(v => v.id)).toEqual(['b', 'a'])
  })

  it('preserves relative order when insertOrder is equal (stable sort)', () => {
    const videos = [
      makeVideo({ id: 'a', insertOrder: 100 }),
      makeVideo({ id: 'b', insertOrder: 100 }),
      makeVideo({ id: 'c', insertOrder: 100 }),
    ]
    const original = videos.map(v => v.id)
    videos.sort(sortByInsertOrder)
    expect(videos.map(v => v.id)).toEqual(original)
  })
})

describe('appendNewItems', () => {
  const byInsertOrder = (a: { insertOrder?: number }, b: { insertOrder?: number }) =>
    (b.insertOrder ?? 0) - (a.insertOrder ?? 0)

  it('keeps already-ordered items in place, no matter their timestamp', () => {
    const prevOrder = ['a', 'b', 'c']
    const items = [
      { id: 'a', insertOrder: 100 },
      { id: 'b', insertOrder: 300 },
      { id: 'c', insertOrder: 200 },
    ]
    // Even though 'b' now has the highest insertOrder, it must not jump to
    // the front — nothing already on screen should ever move.
    expect(appendNewItems(prevOrder, items, byInsertOrder)).toEqual(['a', 'b', 'c'])
  })

  it('appends newly-discovered items at the end, sorted among themselves', () => {
    const prevOrder = ['a', 'b']
    const items = [
      { id: 'a', insertOrder: 100 },
      { id: 'b', insertOrder: 90 },
      { id: 'new-recent', insertOrder: 500 },
      { id: 'new-old', insertOrder: 10 }, // e.g. backfilled older content
    ]
    expect(appendNewItems(prevOrder, items, byInsertOrder)).toEqual(['a', 'b', 'new-recent', 'new-old'])
  })

  it('drops ids that are no longer present (e.g. muted or deleted)', () => {
    const prevOrder = ['a', 'b', 'c']
    const items = [
      { id: 'a', insertOrder: 100 },
      { id: 'c', insertOrder: 80 },
    ]
    expect(appendNewItems(prevOrder, items, byInsertOrder)).toEqual(['a', 'c'])
  })

  it('sorts the initial batch (empty prevOrder) by the given comparator', () => {
    const items = [
      { id: 'a', insertOrder: 100 },
      { id: 'b', insertOrder: 300 },
      { id: 'c', insertOrder: 200 },
    ]
    expect(appendNewItems([], items, byInsertOrder)).toEqual(['b', 'c', 'a'])
  })

  it('retains an already-shown id missing from the batch when isStillValid says so', () => {
    // e.g. the query now only returns *unwatched* videos, so a watched item
    // that's still on screen is legitimately absent from `items` without
    // having been deleted, muted, or hidden.
    const prevOrder = ['a', 'b', 'c']
    const items = [
      { id: 'a', insertOrder: 100 },
      // 'b' watched, dropped out of the unwatched query — but still valid.
      { id: 'c', insertOrder: 80 },
    ]
    const isStillValid = (id: string) => id === 'b'
    expect(appendNewItems(prevOrder, items, byInsertOrder, isStillValid)).toEqual(['a', 'b', 'c'])
  })

  it('drops an already-shown id missing from the batch when isStillValid returns false', () => {
    const prevOrder = ['a', 'b', 'c']
    const items = [
      { id: 'a', insertOrder: 100 },
      { id: 'c', insertOrder: 80 },
    ]
    const isStillValid = () => false // e.g. 'b' was muted or deleted
    expect(appendNewItems(prevOrder, items, byInsertOrder, isStillValid)).toEqual(['a', 'c'])
  })
})
