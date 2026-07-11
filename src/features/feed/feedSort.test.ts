import { describe, it, expect } from 'vitest'
import { sortByInsertOrder } from './feedSort'
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
