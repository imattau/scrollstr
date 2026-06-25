import { SimplePool, type NostrEvent } from 'nostr-tools'
import NDK from '@nostr-dev-kit/ndk'
import NDKCacheAdapterDexie from '@nostr-dev-kit/cache-dexie'
import { EventStore } from 'applesauce-core'
import { Observable } from 'rxjs'
import type { NostrPool } from 'applesauce-signers'

const HEX_FIELDS = new Set(['ids', 'authors', '#e', '#p', '#a', '#d'])

function isHex(s: string): boolean {
  return s.length % 2 === 0 && /^[0-9a-f]+$/i.test(s)
}

function sanitizeFilters(filters: any | any[]): any[] {
  const list = Array.isArray(filters) ? filters : [filters]
  return list.map((f: any) => {
    const clean: any = { ...f }
    for (const key of HEX_FIELDS) {
      if (Array.isArray(clean[key])) {
        clean[key] = clean[key].filter((v: any) => typeof v === 'string' && isHex(v))
      }
    }
    return clean
  })
}

export const DEFAULT_RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.snort.social',
  'wss://purplepag.es',
]

export const pool = new SimplePool()

export let activeRelays: string[] = [...DEFAULT_RELAYS]

export const setActiveRelays = (urls: string[]) => {
  activeRelays = urls.length > 0 ? urls : [...DEFAULT_RELAYS]
}

// NDK instance + cache adapter for IndexedDB persistence only
const cacheAdapter = new NDKCacheAdapterDexie({ dbName: 'scrollstr-ndk-cache' })
export const ndk = new NDK({ cacheAdapter })

export const eventStore = new EventStore()

const MOCK_EVENTS = [
  {
    kind: 21,
    id: 'deadbeef00000000000000000000000000000000000000000000000000000001',
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
      ['imeta', 'url /videos/The_Neon_Mascot_A_short_loop.mp4', 'm video/mp4'],
    ],
    sig: 'local-preview-sig',
  },
  {
    kind: 21,
    id: "deadbeef00000000000000000000000000000000000000000000000000000002",
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
      ["imeta", "url https://assets.mixkit.co/videos/preview/mixkit-girl-in-neon-lit-city-street-at-night-42218-large.mp4", "m video/mp4", "image https://images.unsplash.com/photo-1518770660439-4636190af475?w=500"]
    ],
    sig: "mock-sig-1"
  },
  {
    kind: 21,
    id: "deadbeef00000000000000000000000000000000000000000000000000000003",
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
      ["imeta", "url https://assets.mixkit.co/videos/preview/mixkit-tree-with-yellow-flowers-42330-large.mp4", "m video/mp4", "image https://images.unsplash.com/photo-1490730141103-6cac27aaab94?w=500"]
    ],
    sig: "mock-sig-2"
  },
  {
    kind: 21,
    id: "deadbeef00000000000000000000000000000000000000000000000000000004",
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
      ["imeta", "url https://assets.mixkit.co/videos/preview/mixkit-man-dancing-under-neon-lights-42223-large.mp4", "m video/mp4", "image https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=500"]
    ],
    sig: "mock-sig-3"
  }
]

MOCK_EVENTS.forEach((ev) => {
  eventStore.add(ev as any)
})

export const getEventsQuery$ = (filters: any): Observable<any[]> => {
  return new Observable<any[]>((subscriber) => {
    subscriber.next(eventStore.getByFilters(filters))
    const subs = [
      eventStore.insert$.subscribe(() => subscriber.next(eventStore.getByFilters(filters))),
      eventStore.update$.subscribe(() => subscriber.next(eventStore.getByFilters(filters))),
      eventStore.remove$.subscribe(() => subscriber.next(eventStore.getByFilters(filters))),
    ]
    return () => subs.forEach((s) => s.unsubscribe())
  })
}

export const getReplaceableQuery$ = (kind: number, pubkey: string): Observable<any> => {
  return new Observable<any>((subscriber) => {
    subscriber.next(eventStore.getReplaceable(kind, pubkey))
    const subs = [
      eventStore.insert$.subscribe(() => subscriber.next(eventStore.getReplaceable(kind, pubkey))),
      eventStore.update$.subscribe(() => subscriber.next(eventStore.getReplaceable(kind, pubkey))),
      eventStore.remove$.subscribe(() => subscriber.next(eventStore.getReplaceable(kind, pubkey))),
    ]
    return () => subs.forEach((s) => s.unsubscribe())
  })
}

const subRegistrations = new Map<symbol, { relays: string[]; filters: any[]; onEvent?: (event: any) => void }>()
let managedClose: (() => void) | null = null
let rebuildScheduled = false

function rebuildManagedSub() {
  if (managedClose) {
    managedClose()
    managedClose = null
  }
  if (subRegistrations.size === 0) return

  const requests: { url: string; filter: any }[] = []
  for (const reg of subRegistrations.values()) {
    const cleaned = sanitizeFilters(reg.filters)
    for (const url of reg.relays) {
      for (const filter of cleaned) {
        requests.push({ url, filter })
      }
    }
  }

  const sub = pool.subscribeMap(requests, {
    onevent(event: any) {
      eventStore.add(event)

      if (eventStore.memory && eventStore.memory.size > 1000) {
        const pruned = eventStore.prune(200)
        if (pruned > 0) {
          console.log(`[EventStore] Memory pruned: removed ${pruned} unclaimed events.`)
        }
      }

      for (const reg of subRegistrations.values()) {
        reg.onEvent?.(event)
      }
    },
  })
  managedClose = () => sub.close()
}

function scheduleRebuild() {
  if (rebuildScheduled) return
  rebuildScheduled = true
  queueMicrotask(() => {
    rebuildScheduled = false
    rebuildManagedSub()
  })
}

export function subscribeToRelays(
  relays: string[],
  filters: any | any[],
  onEvent?: (event: any) => void
): () => void {
  const key = Symbol()
  const filterList = Array.isArray(filters) ? filters : [filters]
  subRegistrations.set(key, { relays, filters: filterList, onEvent })
  scheduleRebuild()

  return () => {
    subRegistrations.delete(key)
    scheduleRebuild()
  }
}

export async function publishToRelays(relays: string[], event: any): Promise<void> {
  try {
    await Promise.any(pool.publish(relays, event))
  } catch (err) {
    console.warn('[pool] All relays rejected publish:', err)
    throw err
  }
}

export async function fetchFromRelays(relays: string[], filters: any | any[]): Promise<any[]> {
  const filterList = sanitizeFilters(filters)
  const results = await Promise.all(filterList.map((f) => pool.querySync(relays, f)))
  return results.flat()
}

export const nostrPool: NostrPool = {
  async publish(relays, event) {
    const results = pool.publish(relays, event)
    await Promise.allSettled(results)
  },
  subscription: (relays, filters) =>
    new Observable<NostrEvent>((subscriber) => {
      const requests = relays.flatMap((url) =>
        filters.map((filter) => ({ url, filter: filter as import('nostr-tools').Filter }))
      )
      const sub = pool.subscribeMap(requests, {
        onevent: (event) => subscriber.next(event),
      })
      return () => sub.close()
    }),
}
