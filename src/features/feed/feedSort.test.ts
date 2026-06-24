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
  it('sorts by createdAt descending as primary key', () => {
    const videos = [
      makeVideo({ id: 'a', createdAt: 100, firstSeen: 999 }),
      makeVideo({ id: 'b', createdAt: 300, firstSeen: 0 }),
      makeVideo({ id: 'c', createdAt: 200, firstSeen: 500 }),
    ]
    videos.sort(sortByFirstSeen)
    expect(videos.map(v => v.id)).toEqual(['b', 'c', 'a'])
  })

  it('falls back to firstSeen when createdAt is equal', () => {
    const videos = [
      makeVideo({ id: 'a', createdAt: 100, firstSeen: 100 }),
      makeVideo({ id: 'b', createdAt: 100, firstSeen: 300 }),
      makeVideo({ id: 'c', createdAt: 100, firstSeen: 200 }),
    ]
    videos.sort(sortByFirstSeen)
    expect(videos.map(v => v.id)).toEqual(['b', 'c', 'a'])
  })

  it('puts LOCAL_PREVIEW_ID first regardless of timestamps', () => {
    const videos = [
      makeVideo({ id: 'a', createdAt: 500 }),
      makeVideo({ id: LOCAL_PREVIEW_ID, createdAt: 100 }),
      makeVideo({ id: 'b', createdAt: 400 }),
    ]
    videos.sort(sortByFirstSeen)
    expect(videos[0].id).toBe(LOCAL_PREVIEW_ID)
  })

  it('treats undefined createdAt as 0', () => {
    const videos = [
      makeVideo({ id: 'a', createdAt: undefined }),
      makeVideo({ id: 'b', createdAt: 100 }),
    ]
    videos.sort(sortByFirstSeen)
    expect(videos.map(v => v.id)).toEqual(['b', 'a'])
  })

  it('treats undefined firstSeen as 0 when createdAt is equal', () => {
    const videos = [
      makeVideo({ id: 'a', createdAt: 100, firstSeen: undefined }),
      makeVideo({ id: 'b', createdAt: 100, firstSeen: 200 }),
    ]
    videos.sort(sortByFirstSeen)
    expect(videos.map(v => v.id)).toEqual(['b', 'a'])
  })
})
