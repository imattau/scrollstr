import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { graph } from '../graph'
import {
  db,
  saveEventToCache,
  bulkSaveEventsToCache,
  getCacheVideoCount,
  getCacheOldestVideoTimestamp,
  mergeCountersIntoShape,
  updateUserVideoState,
  updateMediaStatus,
  buildOrUpdateAuthorProfile,
  pruneCache,
  pruneBlockedContent,
} from './cache'
import type { VideoShape, CachedEvent, CreatorProfileRecord } from './cache'

// ── Helpers ──

function nip21Event(id: string, pubkey: string, kind: number, tags: any[][], content = ''): any {
  return {
    id,
    pubkey,
    kind,
    tags,
    content,
    created_at: Math.floor(Date.now() / 1000),
    sig: 'local-preview-sig',
  }
}

const ALICE = 'a' .repeat(64)
const BOB = 'b'.repeat(64)

beforeEach(async () => {
  graph.clear()
  await graph.persistence.clearAll()
})

afterEach(async () => {
  await graph.persistence.clearAll()
})

// ── Tests ──

describe('Nostr event cache — realistic scenarios', () => {

  it('saves and retrieves a kind-21 video event (nip21 with imeta)', async () => {
    const event = nip21Event('vid001', ALICE, 21, [
      ['title', 'My Video'],
      ['t', 'nostr'],
      ['t', 'video'],
      ['imeta', 'url https://cdn.example.com/video.mp4', 'm video/mp4', 'image https://cdn.example.com/thumb.jpg'],
    ])
    await saveEventToCache(event)

    // Event should be findable as cached event
    const cached = await db.cachedEvents.get('vid001')
    expect(cached).toBeDefined()
    expect(cached!.kind).toBe(21)
    expect(cached!.pubkey).toBe(ALICE)

    // Video shape should be built with correct URL
    const shape = await db.videoShapes.get('vid001')
    expect(shape).toBeDefined()
    expect((shape as any).videoUrl).toBe('https://cdn.example.com/video.mp4')
    expect((shape as any).title).toBe('My Video')
    expect((shape as any).insertOrder).toBeGreaterThan(0)

    // Query by kind — should find this video
    const byKind = await db.cachedEvents.where({ kind: 21, pubkey: ALICE }).toArray()
    expect(byKind).toHaveLength(1)

    // Query video shapes ordered by insertOrder
    const feed = await db.videoShapes.orderBy('insertOrder').reverse().limit(10).toArray()
    // With the videoUrl filter in feed queries, raw events without videoUrl are excluded
    const withUrl = feed.filter((s: any) => s.videoUrl)
    expect(withUrl.length).toBeGreaterThanOrEqual(1)

    // Vector should be computed
    expect(graph.vectors.has('vid001')).toBe(true)
  })

  it('rejects kind-1 events without video URLs', async () => {
    const event = nip21Event('note-no-vid', ALICE, 1, [], 'Hello world, no video here!')
    await saveEventToCache(event)

    const cached = await db.cachedEvents.get('note-no-vid')
    expect(cached).toBeUndefined()
    const rejection = await db.kindOneRejections.get('note-no-vid')
    expect(rejection).toBeDefined()
    expect(rejection!.reason).toBe('no_video_url')
  })

  it('saves kind-1 events with video URLs', async () => {
    const event = nip21Event('note-vid', ALICE, 1, [
      ['t', 'nostr'],
    ], 'Check out this video https://cdn.example.com/clip.mp4')
    await saveEventToCache(event)

    const cached = await db.cachedEvents.get('note-vid')
    expect(cached).toBeDefined()
    expect(cached!.kind).toBe(1)
    expect(cached!.pubkey).toBe(ALICE)

    const shape = await db.videoShapes.get('note-vid')
    expect(shape).toBeDefined()
    expect((shape as any).videoUrl).toBe('https://cdn.example.com/clip.mp4')
  })

  it('saves and retrieves author profiles (kind 0)', async () => {
    const profileEvent = nip21Event('prof001', ALICE, 0, [], JSON.stringify({
      name: 'alice',
      display_name: 'Alice',
      picture: 'https://cdn.example.com/avatar.png',
      about: 'Nostr user',
      nip05: 'alice@example.com',
    }))
    await saveEventToCache(profileEvent)

    const profile = await db.authorProfiles.get(ALICE)
    expect(profile).toBeDefined()
    expect(profile!.name).toBe('alice')
    expect(profile!.displayName).toBe('Alice')
    expect(profile!.picture).toBe('https://cdn.example.com/avatar.png')
    expect(profile!.nip05).toBe('alice@example.com')

    // Profile should also be findable via cachedEvents
    const cached = await db.cachedEvents.get('prof001')
    expect(cached).toBeDefined()
    expect(cached!.kind).toBe(0)
  })

  it('updates author name on video shapes when profile arrives', async () => {
    // First, save a video by Alice
    const videoEvent = nip21Event('vid-alice', ALICE, 21, [
      ['title', 'Alice Video'],
      ['imeta', 'url https://cdn.example.com/v.mp4', 'm video/mp4'],
    ])
    await saveEventToCache(videoEvent)

    // Shape should have authorName as undefined initially
    let shape = await db.videoShapes.get('vid-alice')
    expect((shape as any).authorName).toBeUndefined()

    // Now save Alice's profile
    const profileEvent = nip21Event('prof-alice', ALICE, 0, [], JSON.stringify({
      name: 'alice',
      display_name: 'Alice',
      picture: 'https://cdn.example.com/avatar.png',
    }))
    await saveEventToCache(profileEvent)

    // Shape should now have authorName
    shape = await db.videoShapes.get('vid-alice')
    expect((shape as any).authorName).toBe('alice')
    expect((shape as any).authorPicture).toBe('https://cdn.example.com/avatar.png')
  })

  it('tracks reaction counts (likes, reposts, replies, zaps)', async () => {
    // Save a video
    const videoEvent = nip21Event('vid-reacts', ALICE, 21, [
      ['title', 'Reactions Test'],
      ['imeta', 'url https://cdn.example.com/v.mp4', 'm video/mp4'],
    ])
    await saveEventToCache(videoEvent)

    // Save reactions from different users
    for (let i = 0; i < 3; i++) {
      await saveEventToCache(nip21Event(`like-${i}`, `pk${i}`, 7, [
        ['e', 'vid-reacts'],
        ['p', ALICE],
      ]))
    }
    for (let i = 0; i < 2; i++) {
      await saveEventToCache(nip21Event(`boost-${i}`, `pk${i}`, 16, [
        ['e', 'vid-reacts'],
        ['p', ALICE],
      ]))
    }
    await saveEventToCache(nip21Event('reply-1', BOB, 1111, [
      ['e', 'vid-reacts'],
      ['p', ALICE],
    ], 'Nice video!'))
    await saveEventToCache(nip21Event('zap-1', BOB, 9735, [
      ['e', 'vid-reacts'],
      ['p', ALICE],
      ['description', JSON.stringify({ tags: [['amount', '21000']] })],
    ]))

    // Check counters
    const counters = await db.videoCounters.get('vid-reacts')
    expect(counters).toBeDefined()
    expect(counters!.reactionCount).toBe(3)
    expect(counters!.repostCount).toBe(2)
    expect(counters!.replyCount).toBe(1)
    expect(counters!.zapCount).toBe(1)
    expect(counters!.zapTotalSats).toBe(21) // 21000 msats = 21 sats

    // Merge counters into shape
    let shape = (await db.videoShapes.get('vid-reacts')) as any
    shape = await mergeCountersIntoShape(shape as VideoShape)
    expect(shape.reactionCount).toBe(3)
    expect(shape.repostCount).toBe(2)
    expect(shape.zapCount).toBe(1)
    expect(shape.zapTotalSats).toBe(21)
  })

  it('handles user video state (liked, watched, boosted, zapped)', async () => {
    const videoEvent = nip21Event('vid-state', ALICE, 21, [
      ['title', 'State Test'],
      ['imeta', 'url https://cdn.example.com/v.mp4', 'm video/mp4'],
    ])
    await saveEventToCache(videoEvent)

    await updateUserVideoState('vid-state', { liked: true, watched: true })
    let state = await db.userVideoState.get('vid-state')
    expect(state!.liked).toBe(true)
    expect(state!.watched).toBe(true)

    // Shape should also be updated
    const shape = await db.videoShapes.get('vid-state') as any
    expect(shape.userState?.liked).toBe(true)
    expect(shape.userState?.watched).toBe(true)

    await updateUserVideoState('vid-state', { boosted: true, zapped: true })
    state = await db.userVideoState.get('vid-state')
    expect(state!.boosted).toBe(true)
    expect(state!.zapped).toBe(true)
    expect(state!.liked).toBe(true) // previous state preserved
  })

  it('caches kind-3 contact lists', async () => {
    const contactEvent = nip21Event('contact-1', ALICE, 3, [
      ['p', BOB, 'wss://relay.example.com'],
      ['p', 'c'.repeat(64), 'wss://relay2.example.com'],
    ])
    await saveEventToCache(contactEvent)

    const contacts = await db.cachedEvents.where({ kind: 3, pubkey: ALICE }).toArray()
    expect(contacts).toHaveLength(1)
    const tags = contacts[0].event.tags
    expect(tags).toHaveLength(2)
    expect(tags[0][0]).toBe('p')
    expect(tags[0][1]).toBe(BOB)
  })

  it('caches kind-10002 relay lists', async () => {
    const relayEvent = nip21Event('relay-1', ALICE, 10002, [
      ['r', 'wss://relay.damus.io'],
      ['r', 'wss://nos.lol'],
    ])
    await saveEventToCache(relayEvent)

    const relays = await db.cachedEvents.where({ kind: 10002, pubkey: ALICE }).toArray()
    expect(relays).toHaveLength(1)
  })

  it('persists and reloads across graph warm cycles', async () => {
    // Save events
    const event = nip21Event('persist-vid', ALICE, 21, [
      ['title', 'Persist Test'],
      ['imeta', 'url https://cdn.example.com/vid.mp4', 'm video/mp4'],
    ])
    await saveEventToCache(event)
    await saveEventToCache(nip21Event('persist-prof', ALICE, 0, [], JSON.stringify({ name: 'alice' })))

    // Flush to IndexedDB
    await graph.flush()

    // Clear memory and reload
    graph.clear()
    await graph.warm()

    // Data should survive
    const cached = await db.cachedEvents.get('persist-vid')
    expect(cached).toBeDefined()
    expect(cached!.kind).toBe(21)
    expect(cached!.pubkey).toBe(ALICE)

    const shape = await db.videoShapes.get('persist-vid')
    expect(shape).toBeDefined()
    expect((shape as any).videoUrl).toBe('https://cdn.example.com/vid.mp4')

    const profile = await db.authorProfiles.get(ALICE)
    expect(profile).toBeDefined()
    expect(profile!.name).toBe('alice')

    // Vectors should survive
    expect(graph.vectors.has('persist-vid')).toBe(true)
  })

  it('handles bulk event insertion', async () => {
    const events = []
    for (let i = 0; i < 50; i++) {
      events.push(nip21Event(`bulk-${i}`, ALICE, 21, [
        ['title', `Bulk Video ${i}`],
        ['imeta', `url https://cdn.example.com/v${i}.mp4`, 'm video/mp4'],
      ]))
    }
    // Add some non-video events mixed in
    events.push(nip21Event('bulk-profile', ALICE, 0, [], JSON.stringify({ name: 'alice' })))
    events.push(nip21Event('bulk-contact', ALICE, 3, [['p', BOB]]))

    await bulkSaveEventsToCache(events)

    // All 50 videos should be findable
    const count = await getCacheVideoCount()
    expect(count).toBe(50)

    // Profile should be saved
    const profile = await db.authorProfiles.get(ALICE)
    expect(profile).toBeDefined()

    // Contact list should be saved
    const contacts = await db.cachedEvents.where({ kind: 3, pubkey: ALICE }).toArray()
    expect(contacts).toHaveLength(1)
  })

  it('updates media status and propagates failure to shapes', async () => {
    const event = nip21Event('vid-media', ALICE, 21, [
      ['title', 'Media Status Test'],
      ['imeta', 'url https://cdn.example.com/v.mp4', 'm video/mp4'],
    ])
    await saveEventToCache(event)

    // Initially unknown
    let shape = await db.videoShapes.get('vid-media') as any
    expect(shape.mediaStatus).toBe('unknown')

    // Update to failed
    await updateMediaStatus('https://cdn.example.com/v.mp4', 'failed')
    shape = await db.videoShapes.get('vid-media') as any
    expect(shape.mediaStatus).toBe('failed')
    expect(shape.isFailed).toBe(true)
  })
})

describe('Query patterns matching real consumer usage', () => {
  it('feed explore query — orderBy insertOrder, limit 200', async () => {
    for (let i = 0; i < 50; i++) {
      await saveEventToCache(nip21Event(`f-${i}`, ALICE, 21, [
        ['title', `V${i}`],
        ['imeta', `url https://cdn.example.com/v${i}.mp4`, 'm video/mp4'],
      ]))
    }

    // This is exactly what useFeedVideos does
    let shapes = await db.videoShapes
      .orderBy('insertOrder')
      .reverse()
      .limit(200)
      .toArray()
    shapes = shapes.filter((s: any) => s.videoUrl && s.mediaStatus !== 'failed')
    expect(shapes.length).toBeGreaterThanOrEqual(1)
  })

  it('profile videos query — by pubkey + video kinds', async () => {
    for (let i = 0; i < 5; i++) {
      await saveEventToCache(nip21Event(`pv-${i}`, ALICE, 21, [
        ['title', `Video ${i}`],
        ['imeta', `url https://cdn.example.com/v${i}.mp4`, 'm video/mp4'],
      ]))
    }
    // Add non-video events for same pubkey
    await saveEventToCache(nip21Event('pv-profile', ALICE, 0, [], JSON.stringify({ name: 'alice' })))

    // This is what ProfilePage does
    const raw = await db.cachedEvents
      .where('pubkey')
      .equals(ALICE)
      .toArray()
    const videoKinds = [1, 21, 22, 34236]
    const videos = raw.filter((e: CachedEvent) => videoKinds.includes(e.kind))
    expect(videos).toHaveLength(5)
  })

  it('comments query — by eTags equals videoId + kind filter', async () => {
    await saveEventToCache(nip21Event('vid-comments', ALICE, 21, [
      ['title', 'Comments Test'],
      ['imeta', 'url https://cdn.example.com/v.mp4', 'm video/mp4'],
    ]))
    for (let i = 0; i < 3; i++) {
      await saveEventToCache(nip21Event(`c-${i}`, BOB, 1111, [
        ['e', 'vid-comments'],
        ['p', ALICE],
      ], `Comment ${i}`))
    }

    // This is what DesktopCommentsPanel does
    const comments = await db.cachedEvents
      .where('eTags')
      .equals('vid-comments')
      .toArray()
    const filtered = comments.filter((e: CachedEvent) => e.kind === 1111)
    expect(filtered).toHaveLength(3)
  })

  it('mute list query — by kind 10000 + pubkey', async () => {
    await saveEventToCache(nip21Event('mute-1', ALICE, 10000, [
      ['p', BOB],
      ['t', 'nsfw'],
    ]))

    const mutes = await db.cachedEvents
      .where({ kind: 10000, pubkey: ALICE })
      .toArray()
    expect(mutes).toHaveLength(1)
    const event = mutes[0].event
    expect(event.tags[0][1]).toBe(BOB)
  })

  it('discover page — recent shapes by created_at', async () => {
    for (let i = 0; i < 10; i++) {
      await saveEventToCache(nip21Event(`d-${i}`, ALICE, 21, [
        ['title', `D${i}`],
        ['imeta', `url https://cdn.example.com/v${i}.mp4`, 'm video/mp4'],
      ]))
    }

    const recent = await db.videoShapes
      .where('created_at')
      .above(Math.floor(Date.now() / 1000) - 48 * 3600)
      .toArray()
    const valid = recent.filter((s: any) => s.videoUrl && s.mediaStatus !== 'failed').slice(0, 500)
    expect(valid.length).toBeGreaterThanOrEqual(1)
  })

  it('backfill worker — counts video events', async () => {
    for (let i = 0; i < 10; i++) {
      await saveEventToCache(nip21Event(`bw-${i}`, ALICE, 21, [
        ['title', `BW${i}`],
        ['imeta', `url https://cdn.example.com/v${i}.mp4`, 'm video/mp4'],
      ]))
    }
    // Mix in non-video events
    await saveEventToCache(nip21Event('bw-profile', ALICE, 0, [], JSON.stringify({ name: 'alice' })))

    const count = await getCacheVideoCount()
    expect(count).toBe(10)

    const oldestTs = await getCacheOldestVideoTimestamp()
    expect(oldestTs).toBeGreaterThan(0)
  })
})
