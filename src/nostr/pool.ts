import { SimplePool, type NostrEvent } from 'nostr-tools'
import { Observable } from 'rxjs'
import type { NostrPool } from 'applesauce-signers'
import { saveEventToCache, bulkSaveEventsToCache } from './cache'
import { getSearchRelays, addDiscoveredRelays, fetchRelayDirectory, sanitizeSearchQuery, setOnDiscoveredChange } from './search-relays'

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

// When new search-capable relays are discovered, update the worker's relay set
setOnDiscoveredChange(() => syncSearchRelaysToWorker())

// ── Backfill event batching ─────────────────────────────────────────────
// Batch accumulator for backfill events — coalesces rapid worker batches
// before flushing to bulkSaveEventsToCache, reducing IDB pressure.
const BACKFILL_FLUSH_SIZE = 20
const BACKFILL_FLUSH_DELAY = 50
let backfillBuffer: any[] = []
let backfillFlushTimer: ReturnType<typeof setTimeout> | null = null

function flushBackfillBuffer(): void {
  backfillFlushTimer = null
  const batch = backfillBuffer
  backfillBuffer = []
  if (batch.length > 0) {
    void processBackfillEvents(batch).catch((err) =>
      console.warn(`[pool] Failed to cache backfill buffer (${batch.length} events):`, err)
    )
  }
}

function pushBackfillEvents(events: any[]): void {
  backfillBuffer.push(...events)
  if (!backfillFlushTimer) {
    backfillFlushTimer = setTimeout(flushBackfillBuffer, BACKFILL_FLUSH_DELAY)
  }
}

async function processBackfillEvents(events: any[]) {
  for (let i = 0; i < events.length; i += BACKFILL_FLUSH_SIZE) {
    const batch = events.slice(i, i + BACKFILL_FLUSH_SIZE)
    await bulkSaveEventsToCache(batch).catch((err) =>
      console.warn(`[pool] Failed to cache backfill batch:`, err)
    )
    if (i + BACKFILL_FLUSH_SIZE < events.length) {
      await new Promise((r) => setTimeout(r, 0))
    }
  }
}

// Batch accumulator for real-time subscription events — collects events and
// flushes them via bulkSaveEventsToCache, avoiding per-event IDB transactions.
const SUBSCRIPTION_FLUSH_INTERVAL = 500
const SUBSCRIPTION_FLUSH_MAX = 50
let subscriptionBatch: any[] = []
let subscriptionFlushTimer: ReturnType<typeof setTimeout> | null = null

function flushSubscriptionBatch(): void {
  subscriptionFlushTimer = null
  const batch = subscriptionBatch
  subscriptionBatch = []
  if (batch.length > 0) {
    void bulkSaveEventsToCache(batch).catch((err) =>
      console.warn(`[pool] Failed to cache subscription batch (${batch.length} events):`, err)
    )
  }
}

function pushSubscriptionEvent(event: any): void {
  subscriptionBatch.push(event)
  if (subscriptionBatch.length >= SUBSCRIPTION_FLUSH_MAX) {
    if (subscriptionFlushTimer) {
      clearTimeout(subscriptionFlushTimer)
      subscriptionFlushTimer = null
    }
    flushSubscriptionBatch()
  } else if (!subscriptionFlushTimer) {
    subscriptionFlushTimer = setTimeout(flushSubscriptionBatch, SUBSCRIPTION_FLUSH_INTERVAL)
  }
}

worker.onmessage = (e: MessageEvent) => {
  const msg = e.data
  switch (msg.type) {
    case 'backfillEvents': {
      pushBackfillEvents((msg as any).events)
      break
    }
    case 'subscriptionEvent': {
      const event = (msg as any).event
      pushSubscriptionEvent(event)
      break
    }
    case 'backfillComplete':
      break
    case 'searchResults': {
      const cb = searchCallbacks.get(msg.id)
      if (cb) { console.log('[Pool] Search', msg.id, 'resolved with', msg.events?.length ?? 0, 'events'); cb.resolve(msg.events); searchCallbacks.delete(msg.id) }
      break
    }
    case 'searchError': {
      console.error('[Pool] Search', msg.id, 'failed:', msg.error)
      const cb = searchCallbacks.get(msg.id)
      if (cb) { cb.reject(new Error(msg.error)); searchCallbacks.delete(msg.id) }
      break
    }
  }
}

export const setActiveRelays = (urls: string[]) => {
  const base = urls.length > 0 ? urls : [...DEFAULT_RELAYS]
  activeRelays = getSearchRelays(base)
  worker.postMessage({ type: 'setActiveRelays', relayUrls: activeRelays })
}

/** Re-sync the worker's relay set — call after new search-capable relays are discovered */
export function syncSearchRelaysToWorker(): void {
  const base = activeRelays.length > 0 ? activeRelays : [...DEFAULT_RELAYS]
  activeRelays = getSearchRelays(base)
  worker.postMessage({ type: 'setActiveRelays', relayUrls: activeRelays })
}

// ── Mock events (seed cache with local preview data) ─────────────────────
// Only loaded in development to provide instant demo content while relays connect.

const MOCK_EVENTS = import.meta.env.DEV
  ? [
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
  : []

queueMicrotask(() => {
  MOCK_EVENTS.forEach((ev) => {
    saveEventToCache(ev as any).catch(() => {})
  })
})

// ── Subscription concurrency manager ────────────────────────────────────
// Limits concurrent subscriptions to avoid "too many requests" from relays.
// Supports priority levels to prevent important subscriptions from starving.

const MAX_CONCURRENT_SUBS = 6
const MAX_QUEUE_SIZE = 50
type SubPriority = 'high' | 'normal' | 'low'
const subMetadata = new Map<string, 'queued' | 'active'>()
const subQueue: Array<{
  id: string
  relays: string[]
  filters: any[]
  priority: SubPriority
}> = []

function processQueue() {
  while (subQueue.length > 0 && subMetadata.size < MAX_CONCURRENT_SUBS) {
    // Find highest-priority item in queue
    let bestIdx = 0
    let bestPriority: SubPriority = 'low'
    for (let i = 0; i < subQueue.length; i++) {
      const p = subQueue[i].priority
      if (p === 'high') {
        bestIdx = i
        break
      }
      if (p === 'normal' && bestPriority === 'low') {
        bestIdx = i
        bestPriority = 'normal'
      }
    }

    const item = subQueue[bestIdx]
    // Skip if this sub was unsubscribed while queued
    if (!subMetadata.has(item.id)) {
      subQueue.splice(bestIdx, 1)
      continue
    }
    subQueue.splice(bestIdx, 1)
    subMetadata.set(item.id, 'active')
    worker.postMessage({ type: 'subscribe', id: item.id, relays: item.relays, filters: item.filters })
  }
}

// ── Subscriptions (proxied to worker with concurrency limit) ────────────

let subIdCounter = 0
const searchCallbacks = new Map<string, { resolve: (events: any[]) => void; reject: (err: any) => void; createdAt: number }>()
// Periodically purge search callbacks older than 30s to prevent leaks
const SEARCH_CALLBACK_TTL = 30000
setInterval(() => {
  const now = Date.now()
  for (const [id, cb] of searchCallbacks) {
    if (now - cb.createdAt > SEARCH_CALLBACK_TTL) {
      cb.reject(new Error('Search timed out'))
      searchCallbacks.delete(id)
    }
  }
}, SEARCH_CALLBACK_TTL)

export function subscribeToRelays(
  relays: string[],
  filters: any | any[],
  priority: SubPriority = 'normal'
): () => void {
  const id = `sub_${++subIdCounter}`
  const filterList = Array.isArray(filters) ? filters : [filters]

  function doUnsubscribe() {
    const idx = subQueue.findIndex((item) => item.id === id)
    if (idx !== -1) {
      subQueue.splice(idx, 1)
      subMetadata.delete(id)
      return
    }
    if (subMetadata.get(id) === 'active') {
      subMetadata.delete(id)
      worker.postMessage({ type: 'unsubscribe', id })
      processQueue()
    }
  }

  if (subMetadata.size < MAX_CONCURRENT_SUBS) {
    subMetadata.set(id, 'active')
    worker.postMessage({ type: 'subscribe', id, relays, filters: filterList })
  } else if (subQueue.length < MAX_QUEUE_SIZE) {
    subMetadata.set(id, 'queued')
    subQueue.push({ id, relays, filters: filterList, priority })
  } else if (priority === 'high') {
    // Drop lowest-priority queued item to make room for high-priority sub
    let dropIdx = -1
    for (let i = subQueue.length - 1; i >= 0; i--) {
      if (subQueue[i].priority === 'low') {
        dropIdx = i
        break
      }
    }
    if (dropIdx === -1) {
      for (let i = subQueue.length - 1; i >= 0; i--) {
        if (subQueue[i].priority === 'normal') {
          dropIdx = i
          break
        }
      }
    }
    if (dropIdx >= 0) {
      const dropped = subQueue.splice(dropIdx, 1)[0]
      subMetadata.delete(dropped.id)
      console.warn(`[pool] Dropped low-priority sub ${dropped.id} for high-priority sub ${id}`)
      subMetadata.set(id, 'queued')
      subQueue.push({ id, relays, filters: filterList, priority })
    } else {
      console.warn(`[pool] Subscription queue full (${MAX_QUEUE_SIZE}), dropping high-priority sub ${id}`)
    }
  } else {
    console.warn(`[pool] Subscription queue full (${MAX_QUEUE_SIZE}), dropping sub ${id}`)
  }

  return doUnsubscribe
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

export async function searchRelays(
  relays: string[],
  query: string,
  options?: { kinds?: number[]; limit?: number; until?: number; signal?: AbortSignal }
): Promise<any[]> {
  const expandedRelays = getSearchRelays(relays)
  if (expandedRelays.length > relays.length) {
    console.log(`[Pool] Expanded search relays: ${relays.length} → ${expandedRelays.length} relays`)
  }
  const safeQuery = sanitizeSearchQuery(query)
  if (!safeQuery) return Promise.resolve([])
  const id = `search_${++subIdCounter}`
  return new Promise<any[]>((resolve, reject) => {
    searchCallbacks.set(id, { resolve, reject, createdAt: Date.now() })
    worker.postMessage({
      type: 'search',
      id,
      relays: expandedRelays,
      query: safeQuery,
      kinds: options?.kinds,
      limit: options?.limit,
      until: options?.until,
    })

    if (options?.signal) {
      if (options.signal.aborted) {
        worker.postMessage({ type: 'abortSearch', id })
        searchCallbacks.delete(id)
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      options.signal.addEventListener('abort', () => {
        worker.postMessage({ type: 'abortSearch', id })
        const cb = searchCallbacks.get(id)
        if (cb) {
          cb.reject(new DOMException('Aborted', 'AbortError'))
          searchCallbacks.delete(id)
        }
      }, { once: true })
    }
  })
}

export { addDiscoveredRelays, fetchRelayDirectory }

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
