import { SimplePool, type NostrEvent } from 'nostr-tools'
import { Observable } from 'rxjs'
import type { NostrPool } from 'applesauce-signers'
import { saveEventToCache } from './cache'

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

// ── Web Worker ───────────────────────────────────────────────────────────

const worker = new Worker(
  new URL('./backfill.worker.ts', import.meta.url),
  { type: 'module' }
)

export { worker as backfillWorker }

worker.onmessage = (e: MessageEvent) => {
  const msg = e.data
  switch (msg.type) {
    case 'backfillEvents': {
      for (const event of (msg as any).events) {
        saveEventToCache(event).catch((err) =>
          console.warn(`[pool] Failed to cache event ${event.id}:`, err)
        )
      }
      break
    }
    case 'subscriptionEvent': {
      const event = (msg as any).event
      saveEventToCache(event).catch((err) =>
        console.warn(`[pool] Failed to cache event ${event.id}:`, err)
      )
      break
    }
    case 'backfillComplete':
      break
  }
}

export const setActiveRelays = (urls: string[]) => {
  activeRelays = urls.length > 0 ? urls : [...DEFAULT_RELAYS]
  worker.postMessage({ type: 'setActiveRelays', relayUrls: activeRelays })
}

// ── Mock events (seed cache with local preview data) ─────────────────────

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
  saveEventToCache(ev as any).catch(() => {})
})

// ── Subscriptions (proxied to worker) ────────────────────────────────────

let subIdCounter = 0

export function subscribeToRelays(
  relays: string[],
  filters: any | any[]
): () => void {
  const id = `sub_${++subIdCounter}`
  const filterList = Array.isArray(filters) ? filters : [filters]
  worker.postMessage({ type: 'subscribe', id, relays, filters: filterList })
  return () => {
    worker.postMessage({ type: 'unsubscribe', id })
  }
}

// ── Publishing & queries (stay on main thread for nip46) ─────────────────

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
