import { createRxNostr } from 'rx-nostr'
import { EventStore } from 'applesauce-core'
import { verifyEvent } from 'nostr-tools'
import { queueCachedEventTouches, saveEventToCache } from './cache'

// List of standard default relays to bootstrap client connection
export const DEFAULT_RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.snort.social',
  'wss://purplepag.es', // Optimized for user profiles search/lookup
]

// Initialize the global rx-nostr client
export const rxNostr = createRxNostr({
  verifier: async (event) => verifyEvent(event),
})
rxNostr.setDefaultRelays(DEFAULT_RELAYS)

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
    kind: 22,
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
    kind: 22,
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
    kind: 22,
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

MOCK_EVENTS.forEach((ev) => eventStore.add(ev as any))

// Listen to all events received on rx-nostr connections, add them to eventStore, and save them to local persistent cache
rxNostr.createAllEventObservable().subscribe((packet) => {
  const event = packet.event as any
  eventStore.add(event)
  
  // Save to persistent IndexedDB cache
  saveEventToCache(event)

  // Periodic memory pruning: If in-memory eventStore grows larger than 1000 events, prune the oldest 200 unclaimed ones
  if (eventStore.memory && eventStore.memory.size > 1000) {
    const pruned = eventStore.prune(200)
    if (pruned > 0) {
      console.log(`[EventStore] Memory pruned: removed ${pruned} unclaimed events.`)
    }
  }
})

import { merge } from 'rxjs'
import { map, startWith } from 'rxjs/operators'

export const getEventsQuery$ = (filters: any) => {
  return merge(eventStore.insert$, eventStore.update$, eventStore.remove$).pipe(
    startWith(null),
    map(() => eventStore.getByFilters(filters))
  )
}
