import { describe, it, expect } from 'vitest'
import { sortByFirstSeen } from './feedSort'
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

describe('sortByFirstSeen', () => {
  it('sorts by firstSeen descending', () => {
    const videos = [
      makeVideo({ id: 'a', firstSeen: 100 }),
      makeVideo({ id: 'b', firstSeen: 300 }),
      makeVideo({ id: 'c', firstSeen: 200 }),
    ]
    videos.sort(sortByFirstSeen)
    expect(videos.map(v => v.id)).toEqual(['b', 'c', 'a'])
  })

  it('puts LOCAL_PREVIEW_ID first regardless of firstSeen', () => {
    const videos = [
      makeVideo({ id: 'a', firstSeen: 500 }),
      makeVideo({ id: LOCAL_PREVIEW_ID, firstSeen: 100 }),
      makeVideo({ id: 'b', firstSeen: 400 }),
    ]
    videos.sort(sortByFirstSeen)
    expect(videos[0].id).toBe(LOCAL_PREVIEW_ID)
  })

  it('treats undefined firstSeen as 0', () => {
    const videos = [
      makeVideo({ id: 'a', firstSeen: undefined }),
      makeVideo({ id: 'b', firstSeen: 100 }),
    ]
    videos.sort(sortByFirstSeen)
    expect(videos.map(v => v.id)).toEqual(['b', 'a'])
  })

  it('preserves relative order when firstSeen is equal (stable sort)', () => {
    const videos = [
      makeVideo({ id: 'a', firstSeen: 100 }),
      makeVideo({ id: 'b', firstSeen: 100 }),
      makeVideo({ id: 'c', firstSeen: 100 }),
    ]
    const original = videos.map(v => v.id)
    videos.sort(sortByFirstSeen)
    expect(videos.map(v => v.id)).toEqual(original)
  })
})
