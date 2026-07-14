import { SimplePool, type Filter, verifyEvent } from 'nostr-tools'
import { PolyPersistence } from '../graph/persistence'

const persistence = new PolyPersistence()
const MAX_VIDEOS = 10000
const VIDEO_KINDS = new Set([1, 21, 22, 34236])

/**
 * Count persisted video events by scanning all event nodes from IndexedDB.
 * The main thread's in-memory graph is not accessible from this worker, so
 * we read directly from the shared IndexedDB persistence layer instead.
 */
async function getCacheVideoCount(): Promise<number> {
  const ids = await persistence.allNodeIds()
  const nodes = await persistence.getNodes(ids)
  let count = 0
  for (const n of nodes) {
    const kind = n.data.kind as number | undefined
    if (kind && VIDEO_KINDS.has(kind)) count++
  }
  return count
}

async function getCacheOldestVideoTimestamp(): Promise<number | null> {
  const ids = await persistence.allNodeIds()
  const nodes = await persistence.getNodes(ids)
  let oldest: number | null = null
  for (const n of nodes) {
    const ts = n.data.created_at as number | undefined
    if (ts && (oldest === null || ts < oldest)) oldest = ts
  }
  return oldest
}

type SubCloser = { close: (reason?: string) => void }

const pool = new SimplePool()
const subs = new Map<string, SubCloser>()
let isBackfillRunning = false
let isProfileBackfillRunning = false
let isFollowedVideoBackfillRunning = false
let activeRelays: string[] = []
const searchedIdsAborted = new Set<string>()

const BACKFILL_BATCH_SIZE = 100
const BATCH_DELAY_MS = 800
const MAX_BATCHES = 30

const PROFILE_BATCH_SIZE = 50
const PROFILE_BATCH_DELAY_MS = 300

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function fetchBatch(relayUrls: string[], until: number): Promise<any[]> {
  try {
    const events = await pool.querySync(relayUrls, {
      kinds: [1, 21, 22, 34236],
      limit: BACKFILL_BATCH_SIZE,
      until,
    })
    return events.filter((ev: any) => {
      if (ev.sig && !ev.sig.startsWith('mock-') && ev.sig !== 'local-preview-sig') {
        try { return verifyEvent(ev as any) } catch { return false }
      }
      return true
    })
  } catch (err) {
    console.warn('[Worker] Relay error during batch fetch:', err)
    return []
  }
}

async function fetchProfileBatch(relayUrls: string[], pubkeys: string[]): Promise<any[]> {
  try {
    const events = await pool.querySync(relayUrls, {
      kinds: [0, 10002],
      authors: pubkeys,
    })
    return events.filter((ev: any) => {
      if (ev.sig && !ev.sig.startsWith('mock-') && ev.sig !== 'local-preview-sig') {
        try { return verifyEvent(ev as any) } catch { return false }
      }
      return true
    })
  } catch (err) {
    console.warn('[Worker] Relay error during profile batch fetch:', err)
    return []
  }
}

function queryWithTimeout(relays: string[], filter: any, timeoutMs: number): Promise<any[]> {
  return new Promise((resolve) => {
    const seen = new Set<string>()
    const allEvents: any[] = []
    let settled = 0
    let finished = false

    const subs = relays.map((relay) => {
      const sub = pool.subscribe([relay], filter as Filter, {
        onevent: (event) => {
          if (finished) return
          if (seen.has(event.id)) return
          seen.add(event.id)
          allEvents.push(event)
        },
        oneose: () => {
          settled++
          if (settled === relays.length && !finished) {
            finished = true
            resolve(allEvents)
          }
        },
      })
      return sub
    })

    // First-result window: resolve as soon as one relay has answered and we
    // have at least some results, giving stragglers a short grace period.
    const graceTimer = setTimeout(() => {
      if (!finished && allEvents.length > 0) {
        finished = true
        subs.forEach((s) => s.close())
        resolve(allEvents)
      }
    }, Math.min(timeoutMs, 2000))

    // Hard timeout: resolve with whatever we have
    setTimeout(() => {
      if (!finished) {
        finished = true
        subs.forEach((s) => s.close())
        clearTimeout(graceTimer)
        resolve(allEvents)
      }
    }, timeoutMs)
  })
}

async function fetchFollowedVideoBatch(relayUrls: string[], pubkeys: string[], until: number): Promise<any[]> {
  try {
    const events = await pool.querySync(relayUrls, {
      kinds: [1, 21, 22, 34236],
      authors: pubkeys,
      limit: BACKFILL_BATCH_SIZE,
      until,
    })
    return events.filter((ev: any) => {
      if (ev.sig && !ev.sig.startsWith('mock-') && ev.sig !== 'local-preview-sig') {
        try { return verifyEvent(ev as any) } catch { return false }
      }
      return true
    })
  } catch (err) {
    console.warn('[Worker] Relay error during followed video batch fetch:', err)
    return []
  }
}

async function handleStartProfileBackfill(relayUrls: string[], pubkeys: string[]) {
  if (isProfileBackfillRunning) return
  isProfileBackfillRunning = true

  const effective: string[] =
    relayUrls && relayUrls.length > 0 ? relayUrls : activeRelays

  console.log(`[Worker] Starting profile backfill for ${pubkeys.length} pubkeys over relays: ${effective.join(', ')}`)

  try {
    for (let i = 0; i < pubkeys.length; i += PROFILE_BATCH_SIZE) {
      const batch = pubkeys.slice(i, i + PROFILE_BATCH_SIZE)
      const events = await fetchProfileBatch(effective, batch)
      if (events.length > 0) {
        self.postMessage({ type: 'backfillEvents', events })
      }
      await delay(PROFILE_BATCH_DELAY_MS)
    }
  } catch (err) {
    console.error('[Worker] Unexpected error during profile backfill:', err)
  } finally {
    isProfileBackfillRunning = false
    console.log(`[Worker] Profile backfill complete. Processed ${pubkeys.length} pubkeys.`)
    self.postMessage({ type: 'profileBackfillComplete' })
  }
}

async function handleStartBackfill(relayUrls: string[]) {
  if (isBackfillRunning) return
  isBackfillRunning = true

  const effective: string[] =
    relayUrls && relayUrls.length > 0 ? relayUrls : activeRelays

  console.log(`[Worker] Starting backfill over relays: ${effective.join(', ')}`)

  try {
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const currentCount = await getCacheVideoCount()
      const remaining = MAX_VIDEOS - currentCount
      if (remaining <= 0) {
        console.log(`[Worker] Cache is full (${currentCount}/${MAX_VIDEOS}). Stopping backfill.`)
        break
      }

      const oldestTs = await getCacheOldestVideoTimestamp()
      const until =
        oldestTs != null
          ? oldestTs - 1
          : Math.floor(Date.now() / 1000)

      console.log(
        `[Worker] Batch ${batch + 1}/${MAX_BATCHES} — ` +
          `fetching up to ${BACKFILL_BATCH_SIZE} events before ts ${until} ` +
          `(cache: ${currentCount}/${MAX_VIDEOS})`
      )

      const events = await fetchBatch(effective, until)
      if (events.length === 0) {
        console.log('[Worker] Relay returned 0 events – history exhausted. Stopping backfill.')
        break
      }

      console.log(`[Worker] Batch ${batch + 1} received ${events.length} events from relays.`)

      self.postMessage({ type: 'backfillEvents', events })

      await delay(BATCH_DELAY_MS)
    }
  } catch (err) {
    console.error('[Worker] Unexpected error during backfill:', err)
  } finally {
    isBackfillRunning = false
    const finalCount = await getCacheVideoCount()
    console.log(`[Worker] Backfill complete. Cache now holds ${finalCount} video events.`)
    self.postMessage({ type: 'backfillComplete' })
  }
}

const FOLLOWED_PUBKEY_BATCH_SIZE = 20

async function handleStartFollowedVideoBackfill(relayUrls: string[], pubkeys: string[]) {
  if (isFollowedVideoBackfillRunning) return
  isFollowedVideoBackfillRunning = true

  const effective: string[] =
    relayUrls && relayUrls.length > 0 ? relayUrls : activeRelays

  console.log(`[Worker] Starting followed-video backfill for ${pubkeys.length} pubkeys over relays: ${effective.join(', ')}`)

  try {
    for (let i = 0; i < pubkeys.length; i += FOLLOWED_PUBKEY_BATCH_SIZE) {
      const currentCount = await getCacheVideoCount()
      if (currentCount >= MAX_VIDEOS) {
        console.log(`[Worker] Cache is full (${currentCount}/${MAX_VIDEOS}). Stopping followed-video backfill.`)
        break
      }

      const batch = pubkeys.slice(i, i + FOLLOWED_PUBKEY_BATCH_SIZE)

      console.log(
        `[Worker] Followed-video group ${Math.floor(i / FOLLOWED_PUBKEY_BATCH_SIZE) + 1}/${Math.ceil(pubkeys.length / FOLLOWED_PUBKEY_BATCH_SIZE)} — ` +
          `fetching up to ${BACKFILL_BATCH_SIZE} events for ${batch.length} pubkeys ` +
          `(cache: ${currentCount}/${MAX_VIDEOS})`
      )

      const events = await fetchFollowedVideoBatch(effective, batch, Math.floor(Date.now() / 1000))
      if (events.length > 0) {
        console.log(`[Worker] Group received ${events.length} events from relays.`)
        self.postMessage({ type: 'backfillEvents', events })
      }

      await delay(200)
    }
  } catch (err) {
    console.error('[Worker] Unexpected error during followed-video backfill:', err)
  } finally {
    isFollowedVideoBackfillRunning = false
    console.log(`[Worker] Followed-video backfill complete.`)
    self.postMessage({ type: 'followedVideoBackfillComplete' })
  }
}

async function handleStartFollowBackfill(relayUrls: string[], pubkeys: string[]) {
  const effective: string[] =
    relayUrls && relayUrls.length > 0 ? relayUrls : activeRelays

  console.log(`[Worker] Starting follow backfill for ${pubkeys.length} pubkeys over relays: ${effective.join(', ')}`)

  try {
    const raw = await pool.querySync(effective, {
      kinds: [3],
      authors: pubkeys,
      limit: 50,
    })
    const events = raw.filter((ev: any) => {
      if (ev.sig && !ev.sig.startsWith('mock-') && ev.sig !== 'local-preview-sig') {
        try { return verifyEvent(ev as any) } catch { return false }
      }
      return true
    })
    if (events.length > 0) {
      console.log(`[Worker] Follow backfill received ${events.length} kind:3 events from relays.`)
      self.postMessage({ type: 'backfillEvents', events })
    }
  } catch (err) {
    console.warn('[Worker] Follow backfill error:', err)
  } finally {
    console.log(`[Worker] Follow backfill complete.`)
    self.postMessage({ type: 'followBackfillComplete' })
  }
}

async function handleStartUserVideoBackfill(relayUrls: string[], pubkeys: string[]) {
  const effective: string[] =
    relayUrls && relayUrls.length > 0 ? relayUrls : activeRelays

  console.log(`[Worker] Starting user-video backfill for ${pubkeys.length} pubkeys over relays: ${effective.join(', ')}`)

  try {
    const raw = await pool.querySync(effective, {
      kinds: [1, 21, 22, 34236],
      authors: pubkeys,
      limit: 100,
    })
    const events = raw.filter((ev: any) => {
      if (ev.sig && !ev.sig.startsWith('mock-') && ev.sig !== 'local-preview-sig') {
        try { return verifyEvent(ev as any) } catch { return false }
      }
      return true
    })
    if (events.length > 0) {
      console.log(`[Worker] User-video backfill received ${events.length} events from relays.`)
      self.postMessage({ type: 'backfillEvents', events })
    }
  } catch (err) {
    console.warn('[Worker] User-video backfill error:', err)
  } finally {
    console.log(`[Worker] User-video backfill complete.`)
    self.postMessage({ type: 'userVideoBackfillComplete' })
  }
}

const HEX_FIELDS = new Set(['ids', 'authors', '#e', '#p', '#a', '#d'])

function isHex(s: string): boolean {
  return s.length % 2 === 0 && /^[0-9a-f]+$/i.test(s)
}

function sanitizeFilters(filters: any[]): any[] {
  return filters.map((f: any) => {
    const clean: any = { ...f }
    for (const key of HEX_FIELDS) {
      if (Array.isArray(clean[key])) {
        clean[key] = clean[key].filter((v: any) => typeof v === 'string' && isHex(v))
      }
    }
    return clean
  })
}

function handleSubscribe(id: string, relays: string[], rawFilters: any[]) {
  const filters = sanitizeFilters(rawFilters)
  if (filters.length === 0) return
  const sub: SubCloser = pool.subscribe(relays, filters[0] as Filter, {
    onevent: (event: any) => {
      // Reject events with invalid signatures inline before forwarding
      if (event.sig && !event.sig.startsWith('mock-') && event.sig !== 'local-preview-sig') {
        try {
          if (!verifyEvent(event as any)) return
        } catch {
          return
        }
      }
      self.postMessage({ type: 'subscriptionEvent', event })
    },
  })
  subs.set(id, sub)
}

function handleUnsubscribe(id: string) {
  const entry = subs.get(id)
  if (entry) {
    entry.close()
    subs.delete(id)
  }
}

async function handleSearch(id: string, relays: string[], query: string, kinds?: number[], limit?: number, until?: number) {
  try {
    if (searchedIdsAborted.has(id)) return
    const filter: any = { search: query }
    if (kinds) filter.kinds = kinds
    if (limit) filter.limit = limit
    if (until) filter.until = until
    const events = await queryWithTimeout(relays, filter, 5000)
    if (searchedIdsAborted.has(id)) return
    self.postMessage({ type: 'searchResults', id, events })
  } catch (err: any) {
    if (searchedIdsAborted.has(id)) return
    self.postMessage({ type: 'searchError', id, error: err.message })
  } finally {
    searchedIdsAborted.delete(id)
  }
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data
  switch (msg.type) {
    case 'startBackfill':
      void handleStartBackfill(msg.relayUrls)
      break
    case 'startProfileBackfill':
      void handleStartProfileBackfill(msg.relayUrls, msg.pubkeys)
      break
    case 'startFollowedVideoBackfill':
      void handleStartFollowedVideoBackfill(msg.relayUrls, msg.pubkeys)
      break
    case 'startFollowBackfill':
      void handleStartFollowBackfill(msg.relayUrls, msg.pubkeys)
      break
    case 'startUserVideoBackfill':
      void handleStartUserVideoBackfill(msg.relayUrls, msg.pubkeys)
      break
    case 'subscribe':
      handleSubscribe(msg.id, msg.relays, msg.filters)
      break
    case 'unsubscribe':
      handleUnsubscribe(msg.id)
      break
    case 'setActiveRelays':
      activeRelays = msg.relayUrls
      break
    case 'search':
      void handleSearch(msg.id, msg.relays, msg.query, msg.kinds, msg.limit, msg.until)
      break
    case 'abortSearch':
      searchedIdsAborted.add(msg.id)
      break
    case 'cleanup':
      for (const [, sub] of subs) sub.close()
      subs.clear()
      searchedIdsAborted.clear()
      pool.close([])
      break
  }
}
