import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { graph } from '../graph'
import { db, saveEventToCache, getSharers } from './cache'
import type { VideoShape } from './cache'

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)

function nip21Event(id: string, pubkey: string, kind: number, tags: any[][], content = ''): any {
  return {
    id, pubkey, kind, tags, content,
    created_at: Math.floor(Date.now() / 1000),
    sig: 'local-preview-sig',
  }
}

beforeEach(async () => {
  graph.clear()
  await graph.persistence.clearAll()
})

afterEach(async () => {
  await graph.persistence.clearAll()
})

describe('Polygraph — many authors, many videos', () => {

  it('two authors sharing the same URL → one shape, both found via graph', async () => {
    const url = 'https://cdn.example.com/viral.mp4'

    // Alice posts
    await saveEventToCache(nip21Event('vid-alice', ALICE, 21, [
      ['title', 'Alice Video'],
      ['imeta', `url ${url}`, 'm video/mp4'],
    ]))
    let shape = await db.videoShapes.get('vid-alice') as VideoShape | undefined
    expect(shape).toBeDefined()
    expect(shape!.videoUrl).toBe(url)

    // Bob shares same URL — dedup: no new shape
    await saveEventToCache(nip21Event('vid-bob', BOB, 21, [
      ['title', 'Bob Video'],
      ['imeta', `url ${url}`, 'm video/mp4'],
    ]))
    const bobShape = await db.videoShapes.get('vid-bob') as VideoShape | undefined
    expect(bobShape).toBeUndefined()

    // Graph query: who shared this URL? Both!
    const sharers = getSharers(url)
    expect(sharers).toContain(ALICE)
    expect(sharers).toContain(BOB)

    // Graph has HAS_MEDIA edges from both events
    const eventsWithUrl = graph.getEdgeSources(url, 'HAS_MEDIA')
    expect(eventsWithUrl.sort()).toEqual(['vid-alice', 'vid-bob'])
  })

  it('one author posting many different URLs → many shapes', async () => {
    for (let i = 0; i < 5; i++) {
      await saveEventToCache(nip21Event(`vid-${i}`, ALICE, 21, [
        ['title', `Video ${i}`],
        ['imeta', `url https://cdn.example.com/${i}.mp4`, 'm video/mp4'],
      ]))
    }

    for (let i = 0; i < 5; i++) {
      const shape = await db.videoShapes.get(`vid-${i}`) as VideoShape | undefined
      expect(shape).toBeDefined()
      expect(shape!.pubkey).toBe(ALICE)
    }
  })

  it('three authors sharing one video → one shape, three sharers', async () => {
    const url = 'https://cdn.example.com/group-vid.mp4'
    for (let i = 0; i < 3; i++) {
      const pk = String(i).repeat(64)
      await saveEventToCache(nip21Event(`vid-${i}`, pk, 21, [
        ['title', `V${i}`],
        ['imeta', `url ${url}`, 'm video/mp4'],
      ]))
    }

    // Only first has a shape
    const shape0 = await db.videoShapes.get('vid-0') as VideoShape | undefined
    expect(shape0).toBeDefined()
    const shape1 = await db.videoShapes.get('vid-1') as VideoShape | undefined
    expect(shape1).toBeUndefined()
    const shape2 = await db.videoShapes.get('vid-2') as VideoShape | undefined
    expect(shape2).toBeUndefined()

    // Graph finds all three sharers
    const sharers = getSharers(url)
    expect(sharers).toHaveLength(3)

    // Feed returns one shape per URL
    const feed = await db.videoShapes.where('videoUrl').equals(url).toArray()
    expect(feed).toHaveLength(1)
  })

  it('many authors sharing many videos — cross-referenced', async () => {
    const url1 = 'https://cdn.example.com/a.mp4'
    const url2 = 'https://cdn.example.com/b.mp4'
    const CHARLIE = 'c'.repeat(64)

    // Alice posts URL1
    await saveEventToCache(nip21Event('a-alice', ALICE, 21, [
      ['title', 'A by Alice'],
      ['imeta', `url ${url1}`, 'm video/mp4'],
    ]))
    // Bob posts URL2
    await saveEventToCache(nip21Event('b-bob', BOB, 21, [
      ['title', 'B by Bob'],
      ['imeta', `url ${url2}`, 'm video/mp4'],
    ]))
    // Charlie shares URL1 (dup)
    await saveEventToCache(nip21Event('a-charlie', CHARLIE, 21, [
      ['title', 'A by Charlie'],
      ['imeta', `url ${url1}`, 'm video/mp4'],
    ]))
    // Bob also shares URL1 (dup)
    await saveEventToCache(nip21Event('a-bob', BOB, 1, [], `Check out ${url1}`))

    // URL1 should have 3 sharers, one canonical shape
    expect(getSharers(url1).sort()).toEqual([ALICE, BOB, CHARLIE].sort())
    const feedA = await db.videoShapes.where('videoUrl').equals(url1).toArray()
    expect(feedA).toHaveLength(1)
    expect(feedA[0].id).toBe('a-alice')

    // URL2 should have 1 sharer
    expect(getSharers(url2)).toEqual([BOB])
    const feedB = await db.videoShapes.where('videoUrl').equals(url2).toArray()
    expect(feedB).toHaveLength(1)
    expect(feedB[0].id).toBe('b-bob')

    // Bob's event for URL1 was kind-1 (text note), should still be tracked via edge
    const bobEvents = graph.getEdgeSources(url1, 'HAS_MEDIA')
    expect(bobEvents).toContain('a-bob')
  })

  it('feed query returns only unique shapes per URL', async () => {
    const url = 'https://cdn.example.com/unique.mp4'
    await saveEventToCache(nip21Event('first', ALICE, 21, [
      ['title', 'Original'],
      ['imeta', `url ${url}`, 'm video/mp4'],
    ]))
    await saveEventToCache(nip21Event('second', BOB, 21, [
      ['title', 'Copy'],
      ['imeta', `url ${url}`, 'm video/mp4'],
    ]))

    const feed = await db.videoShapes.where('videoUrl').equals(url).toArray()
    expect(feed).toHaveLength(1)
    expect(feed[0].id).toBe('first')
  })
})
