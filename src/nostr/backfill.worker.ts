import { SimplePool, type Filter } from 'nostr-tools'
import { getCacheVideoCount, getCacheOldestVideoTimestamp, MAX_VIDEOS } from './cache'

type SubCloser = { close: (reason?: string) => void }

const pool = new SimplePool()
const subs = new Map<string, SubCloser>()
let isBackfillRunning = false
let isProfileBackfillRunning = false
let isFollowedVideoBackfillRunning = false
let activeRelays: string[] = []

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
    return events
  } catch (err) {
    console.warn('[Worker] Relay error during batch fetch:', err)
    return []
  }
}

async function fetchProfileBatch(relayUrls: string[], pubkeys: string[]): Promise<any[]> {
  try {
    const events = await pool.querySync(relayUrls, {
      kinds: [0],
      authors: pubkeys,
    })
    return events
  } catch (err) {
    console.warn('[Worker] Relay error during profile batch fetch:', err)
    return []
  }
}

async function fetchFollowedVideoBatch(relayUrls: string[], pubkeys: string[], until: number): Promise<any[]> {
  try {
    const events = await pool.querySync(relayUrls, {
      kinds: [1, 21, 22, 34236],
      authors: pubkeys,
      limit: BACKFILL_BATCH_SIZE,
      until,
    })
    return events
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

async function handleStartFollowedVideoBackfill(relayUrls: string[], pubkeys: string[]) {
  if (isFollowedVideoBackfillRunning) return
  isFollowedVideoBackfillRunning = true

  const effective: string[] =
    relayUrls && relayUrls.length > 0 ? relayUrls : activeRelays

  console.log(`[Worker] Starting followed-video backfill for ${pubkeys.length} pubkeys over relays: ${effective.join(', ')}`)

  try {
    let until = Math.floor(Date.now() / 1000)

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const currentCount = await getCacheVideoCount()
      const remaining = MAX_VIDEOS - currentCount
      if (remaining <= 0) {
        console.log(`[Worker] Cache is full (${currentCount}/${MAX_VIDEOS}). Stopping followed-video backfill.`)
        break
      }

      console.log(
        `[Worker] Followed-video batch ${batch + 1}/${MAX_BATCHES} — ` +
          `fetching up to ${BACKFILL_BATCH_SIZE} events before ts ${until} ` +
          `(cache: ${currentCount}/${MAX_VIDEOS})`
      )

      const events = await fetchFollowedVideoBatch(effective, pubkeys, until)
      if (events.length === 0) {
        console.log('[Worker] Relay returned 0 followed-video events – history exhausted. Stopping.')
        break
      }

      console.log(`[Worker] Followed-video batch ${batch + 1} received ${events.length} events from relays.`)

      self.postMessage({ type: 'backfillEvents', events })

      const oldestInBatch = Math.min(...events.map((e: any) => e.created_at))
      until = oldestInBatch - 1

      await delay(BATCH_DELAY_MS)
    }
  } catch (err) {
    console.error('[Worker] Unexpected error during followed-video backfill:', err)
  } finally {
    isFollowedVideoBackfillRunning = false
    console.log(`[Worker] Followed-video backfill complete.`)
    self.postMessage({ type: 'followedVideoBackfillComplete' })
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
    case 'subscribe':
      handleSubscribe(msg.id, msg.relays, msg.filters)
      break
    case 'unsubscribe':
      handleUnsubscribe(msg.id)
      break
    case 'setActiveRelays':
      activeRelays = msg.relayUrls
      break
  }
}
