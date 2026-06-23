import { SimplePool } from 'nostr-tools'
import { EventStore } from 'applesauce-core'
import { queueCachedEventTouches, saveEventToCache } from './cache'

// List of standard default relays to bootstrap client connection
export const DEFAULT_RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.snort.social',
  'wss://purplepag.es', // Optimized for user profiles search/lookup
]

// Global nostr-tools SimplePool — manages WebSocket connections to relays
export const pool = new SimplePool()

// Current relay list (mutable, updated when user relay list resolves)
export let activeRelays: string[] = [...DEFAULT_RELAYS]

export const setActiveRelays = (urls: string[]) => {
  activeRelays = urls.length > 0 ? urls : [...DEFAULT_RELAYS]
}

// Initialize global Applesauce EventStore
export const eventStore = new EventStore()

const originalGetByFilters = eventStore.getByFilters.bind(eventStore)
const originalGetReplaceable = eventStore.getReplaceable.bind(eventStore)

eventStore.getByFilters = ((filters: any) => {
  const events = originalGetByFilters(filters)
  queueCachedEventTouches(events.map((event: any) => event.id))
  return events
}) as any

eventStore.getReplaceable = ((kind: number, pubkey: string) => {
  const event = originalGetReplaceable(kind, pubkey)
  if (event?.id) {
    queueCachedEventTouches([event.id])
  }
  return event
}) as any

// Seed EventStore with default high-quality mock video events to ensure content loads immediately
const MOCK_EVENTS = [
  {
    kind: 21,
    id: 'local-preview-neon-mascot',
    pubkey: '8459424242424242424242424242424242424242424242424242424242424242',
    created_at: Math.floor(Date.now() / 1000),
    content: 'The Neon Mascot loop, bundled locally so the feed has instant motion while relays connect.',
    tags: [
      ['title', 'The Neon Mascot'],
      ['published_at', Math.floor(Date.now() / 1000).toString()],
      ['alt', 'The Neon Mascot'],
      ['t', 'neon'],
      ['t', 'mascot'],
      ['t', 'scrollstr'],
      [
        'imeta',
        'url /videos/The_Neon_Mascot_A_short_loop.mp4',
        'm video/mp4',
      ],
    ],
    sig: 'local-preview-sig',
  },
  {
    kind: 21,
    id: "mock-video-1",
    pubkey: "8459424242424242424242424242424242424242424242424242424242424242",
    created_at: Math.floor(Date.now() / 1000) - 3600,
    content: "Exploring the vibrant neon streets of Melbourne at night! #melbourne #nightwalk #nostr",
    tags: [
      ["title", "Melbourne Neon Nights"],
      ["published_at", (Math.floor(Date.now() / 1000) - 3600).toString()],
      ["alt", "Melbourne Neon Nights"],
      ["t", "melbourne"],
      ["t", "nightwalk"],
      ["t", "nostr"],
      [
        "imeta",
        "url https://assets.mixkit.co/videos/preview/mixkit-girl-in-neon-lit-city-street-at-night-42218-large.mp4",
        "m video/mp4",
        "image https://images.unsplash.com/photo-1518770660439-4636190af475?w=500"
      ]
    ],
    sig: "mock-sig-1"
  },
  {
    kind: 21,
    id: "mock-video-2",
    pubkey: "9283928392839283928392839283928392839283928392839283928392839283",
    created_at: Math.floor(Date.now() / 1000) - 7200,
    content: "Beautiful yellow flowers swaying in the gentle spring breeze. #nature #flowers #peaceful",
    tags: [
      ["title", "Spring Flowers"],
      ["published_at", (Math.floor(Date.now() / 1000) - 7200).toString()],
      ["alt", "Spring Flowers"],
      ["t", "nature"],
      ["t", "flowers"],
      ["t", "peaceful"],
      [
        "imeta",
        "url https://assets.mixkit.co/videos/preview/mixkit-tree-with-yellow-flowers-42330-large.mp4",
        "m video/mp4",
        "image https://images.unsplash.com/photo-1490730141103-6cac27aaab94?w=500"
      ]
    ],
    sig: "mock-sig-2"
  },
  {
    kind: 21,
    id: "mock-video-3",
    pubkey: "7362736273627362736273627362736273627362736273627362736273627362",
    created_at: Math.floor(Date.now() / 1000) - 10800,
    content: "Sleek dance moves under the colorful neon lights. #dance #neon #vibes",
    tags: [
      ["title", "Neon Dance Session"],
      ["published_at", (Math.floor(Date.now() / 1000) - 10800).toString()],
      ["alt", "Neon Dance Session"],
      ["t", "dance"],
      ["t", "neon"],
      ["t", "vibes"],
      [
        "imeta",
        "url https://assets.mixkit.co/videos/preview/mixkit-man-dancing-under-neon-lights-42223-large.mp4",
        "m video/mp4",
        "image https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=500"
      ]
    ],
    sig: "mock-sig-3"
  }
]

MOCK_EVENTS.forEach((ev) => {
  eventStore.add(ev as any)
  saveEventToCache(ev as any)
})

import { merge } from 'rxjs'
import { map, startWith } from 'rxjs/operators'

export const getEventsQuery$ = (filters: any) => {
  return merge(eventStore.insert$, eventStore.update$, eventStore.remove$).pipe(
    startWith(null),
    map(() => eventStore.getByFilters(filters))
  )
}

/**
 * Reactive observable for a single replaceable event (kind 0, 3, 10002, etc.).
 * Uses getReplaceable() which is the correct Applesauce API for these kinds —
 * unlike getByFilters, it goes directly to the replaceable index without filter overhead.
 */
export const getReplaceableQuery$ = (kind: number, pubkey: string) => {
  return merge(eventStore.insert$, eventStore.update$, eventStore.remove$).pipe(
    startWith(null),
    map(() => eventStore.getReplaceable(kind, pubkey))
  )
}

/**
 * Subscribe to relay events and feed them into the EventStore + IndexedDB cache.
 * Returns an unsubscribe function.
 *
 * @param relays   Relay URLs to connect to
 * @param filters  One or more Nostr filter objects
 * @param onEvent  Optional extra callback per event
 */
export function subscribeToRelays(
  relays: string[],
  filters: any | any[],
  onEvent?: (event: any) => void
): () => void {
  const filterList = Array.isArray(filters) ? filters : [filters]

  const handleEvent = (event: any) => {
    if (event.kind === 10002) {
      console.log(
        `[pool] kind:10002 received for ${event.pubkey}:`,
        event.tags?.filter((t: string[]) => t[0] === 'r').map((t: string[]) => t[1])
      )
    }
    eventStore.add(event)
    saveEventToCache(event)

    // Periodic memory pruning
    if (eventStore.memory && eventStore.memory.size > 1000) {
      const pruned = eventStore.prune(200)
      if (pruned > 0) {
        console.log(`[EventStore] Memory pruned: removed ${pruned} unclaimed events.`)
      }
    }

    onEvent?.(event)
  }

  const subs = filterList.map((f) => pool.subscribeMany(relays, f, { onevent: handleEvent }))
  return () => subs.forEach((s) => s.close())
}

/**
 * Publish a signed Nostr event to one or more relays.
 * Returns a promise that resolves when at least one relay accepts it,
 * or rejects if all fail (with a best-effort warning).
 */
export async function publishToRelays(relays: string[], event: any): Promise<void> {
  try {
    await Promise.any(pool.publish(relays, event))
  } catch (err) {
    console.warn('[pool] All relays rejected publish:', err)
    throw err
  }
}

/**
 * One-shot fetch of events from relays (uses querySync under the hood).
 * Resolves with all events returned before EOSE.
 */
export async function fetchFromRelays(relays: string[], filters: any | any[]): Promise<any[]> {
  const filterList = Array.isArray(filters) ? filters : [filters]
  const results = await Promise.all(filterList.map((f) => pool.querySync(relays, f)))
  return results.flat()
}
