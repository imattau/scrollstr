import { SimplePool, type Filter, verifyEvent } from 'nostr-tools'
import { PolyPersistence } from '../graph/persistence'
import type { NodeType } from '../graph/types'

const persistence = new PolyPersistence()
const MAX_VIDEOS = 10000
const MAX_EVENT_NODES = 30000
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
const subs = new Map<string, Array<{ close: (reason?: string) => void; relay: string }>>()
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

// Bounded, exponential backoff used only when NO relay could be reached at
// all. Deliberately short — this recovers from a transient blip within a
// single batch's lifetime, it isn't a long-lived retry queue.
const RECONNECT_RETRY_DELAYS_MS = [500, 1000, 2000, 4000]

/**
 * Resolve true as soon as any relay in `relayUrls` is reachable, false only
 * once every relay's connection attempt has failed. pool.ensureRelay() is
 * cheap to call even when already connected — SimplePool memoizes the
 * connection and AbstractRelay.connect() returns the cached promise.
 */
function anyRelayReachable(relayUrls: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    if (relayUrls.length === 0) { resolve(false); return }
    let pending = relayUrls.length
    for (const url of relayUrls) {
      pool.ensureRelay(url).then(
        () => resolve(true),
        () => { if (--pending === 0) resolve(false) }
      )
    }
  })
}

/**
 * Shared retry-with-backoff wrapper for backfill relay queries.
 * pool.querySync() never rejects — even when every relay is unreachable it
 * resolves via onclose with an empty array — so an empty result alone can't
 * tell us "nothing more to fetch" from "couldn't reach anything." We check
 * reachability directly first; only when nothing is reachable do we back off
 * and retry. A result from a reachable relay is trusted as-is, even if empty.
 */
async function queryRelaysWithRetry(
  relayUrls: string[],
  filter: Filter,
  label: string
): Promise<{ events: any[]; unreachable: boolean }> {
  for (let attempt = 0; ; attempt++) {
    if (await anyRelayReachable(relayUrls)) {
      const events = await pool.querySync(relayUrls, filter)
      return { events, unreachable: false }
    }
    if (attempt >= RECONNECT_RETRY_DELAYS_MS.length) {
      console.warn(`[Worker] ${label}: no relay reachable after ${attempt + 1} attempts, giving up for now.`)
      return { events: [], unreachable: true }
    }
    const backoff = RECONNECT_RETRY_DELAYS_MS[attempt]
    console.warn(`[Worker] ${label}: no relay reachable (attempt ${attempt + 1}/${RECONNECT_RETRY_DELAYS_MS.length + 1}), retrying in ${backoff}ms...`)
    await delay(backoff)
  }
}

function filterVerified(events: any[]): any[] {
  return events.filter((ev: any) => {
    if (ev.sig && !ev.sig.startsWith('mock-') && ev.sig !== 'local-preview-sig') {
      try { return verifyEvent(ev as any) } catch { return false }
    }
    return true
  })
}

async function fetchBatch(relayUrls: string[], until: number): Promise<{ events: any[]; unreachable: boolean }> {
  const { events, unreachable } = await queryRelaysWithRetry(
    relayUrls,
    { kinds: [1, 21, 22, 34236], limit: BACKFILL_BATCH_SIZE, until },
    'fetchBatch'
  )
  return { events: filterVerified(events), unreachable }
}

async function fetchProfileBatch(relayUrls: string[], pubkeys: string[]): Promise<{ events: any[]; unreachable: boolean }> {
  const { events, unreachable } = await queryRelaysWithRetry(
    relayUrls,
    { kinds: [0, 10002], authors: pubkeys },
    'fetchProfileBatch'
  )
  return { events: filterVerified(events), unreachable }
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

async function fetchFollowedVideoBatch(relayUrls: string[], pubkeys: string[], until: number): Promise<{ events: any[]; unreachable: boolean }> {
  const { events, unreachable } = await queryRelaysWithRetry(
    relayUrls,
    { kinds: [1, 21, 22, 34236], authors: pubkeys, limit: BACKFILL_BATCH_SIZE, until },
    'fetchFollowedVideoBatch'
  )
  return { events: filterVerified(events), unreachable }
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
      const { events, unreachable } = await fetchProfileBatch(effective, batch)
      if (unreachable) {
        console.warn(`[Worker] Profile batch starting at pubkey ${i}: no relay reachable after retries, skipping this batch.`)
      } else if (events.length > 0) {
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

      const { events, unreachable } = await fetchBatch(effective, until)
      if (events.length === 0) {
        if (unreachable) {
          console.warn(
            `[Worker] Batch ${batch + 1}: no relay reachable after retries — stopping this backfill session ` +
            `(transient network issue, NOT history exhaustion; will resume from the same cursor next session).`
          )
        } else {
          console.log('[Worker] Relay returned 0 events – history exhausted. Stopping backfill.')
        }
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

      const { events, unreachable } = await fetchFollowedVideoBatch(effective, batch, Math.floor(Date.now() / 1000))
      if (unreachable) {
        console.warn(`[Worker] Followed-video group ${Math.floor(i / FOLLOWED_PUBKEY_BATCH_SIZE) + 1}: no relay reachable after retries, skipping this group.`)
      } else if (events.length > 0) {
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
    const { events: raw, unreachable } = await queryRelaysWithRetry(
      effective,
      { kinds: [3], authors: pubkeys, limit: 50 },
      'Follow backfill'
    )
    if (unreachable) {
      console.warn('[Worker] Follow backfill: no relay reachable after retries, giving up for this pubkey set.')
    }
    const events = filterVerified(raw)
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
    const { events: raw, unreachable } = await queryRelaysWithRetry(
      effective,
      { kinds: [1, 21, 22, 34236], authors: pubkeys, limit: 100 },
      'User-video backfill'
    )
    if (unreachable) {
      console.warn('[Worker] User-video backfill: no relay reachable after retries, giving up for this pubkey set.')
    }
    const events = filterVerified(raw)
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
  const entries: Array<{ close: (reason?: string) => void; relay: string }> = []
  for (const relay of relays) {
    const sub = pool.subscribe([relay], filters[0] as Filter, {
      onevent: (event: any) => {
        if (event.sig && !event.sig.startsWith('mock-') && event.sig !== 'local-preview-sig') {
          try {
            if (!verifyEvent(event as any)) return
          } catch {
            return
          }
        }
        self.postMessage({ type: 'subscriptionEvent', event, relay })
      },
    })
    entries.push({ close: (reason?: string) => sub.close(reason), relay })
  }
  subs.set(id, entries)
}

function handleUnsubscribe(id: string) {
  const entries = subs.get(id)
  if (entries) {
    for (const e of entries) e.close()
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

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

/** Load all nodes of a given type from IDB. */
async function loadNodesByType(type: NodeType): Promise<any[]> {
  const ids = await persistence.allNodeIds(type)
  if (ids.length === 0) return []
  return persistence.getNodes(ids)
}

/**
 * Prune excess videos and orphan data from IndexedDB.
 * The main thread must call flush() before invoking this so IDB is consistent
 * with the in-memory graph. Returns the list of removed node IDs.
 */
async function handlePruneCache(): Promise<void> {
  const removedIds: string[] = []

  // 1. Load all video shapes sorted by insertOrder
  const shapes = (await loadNodesByType('video_shape'))
    .map((n: any) => ({ id: n.id, data: n.data }))
    .sort((a: any, b: any) => (a.data.insertOrder ?? 0) - (b.data.insertOrder ?? 0))

  const excess = shapes.length - MAX_VIDEOS
  if (excess <= 0) {
    self.postMessage({ type: 'pruneResult', removedIds })
    return
  }

  const oldestShapes = shapes.slice(0, excess)
  const oldestIdSet = new Set(oldestShapes.map((s: any) => s.id.replace('shp:', '')))
  const videoUrls = oldestShapes.filter((s: any) => s.data.videoUrl).map((s: any) => s.data.videoUrl)

  // 2. Find reaction events referencing the oldest shapes
  const events = await loadNodesByType('event')
  const reactionIds: string[] = []
  for (const node of events) {
    const kind = node.data.kind as number | undefined
    if (kind && [7, 16, 9735, 1111].includes(kind)) {
      const eTags = (node.data.eTags as string[]) ?? []
      if (eTags.some((eid: string) => oldestIdSet.has(eid))) {
        reactionIds.push(node.id)
      }
    }
  }

  // 3. Remove reaction events + oldest shapes from IDB
  const toRemove = [...reactionIds, ...oldestShapes.map((s: any) => s.id)]
  for (const id of toRemove) {
    await persistence.deleteNode(id)
    removedIds.push(id)
  }

  // 4. Remove stale rejection nodes (>30 days)
  const oldThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000
  const rejections = await loadNodesByType('rejection')
  for (const node of rejections) {
    const checkedAt = node.data.checkedAt as number | undefined
    if (checkedAt !== undefined && checkedAt < oldThreshold) {
      await persistence.deleteNode(node.id)
      removedIds.push(node.id)
    }
  }

  // 5. Remove orphan media nodes
  const urlSet = new Set(videoUrls)
  const mediaNodes = await loadNodesByType('media')
  for (const node of mediaNodes) {
    if (urlSet.has(node.id)) {
      await persistence.deleteNode(node.id)
      removedIds.push(node.id)
    }
  }

  // 6. Remove orphan profiles
  const remainingPubkeys = new Set<string>()
  for (const s of shapes) {
    if (s.data.pubkey) remainingPubkeys.add(s.data.pubkey)
  }
  for (const node of events) {
    if (node.data.pubkey) remainingPubkeys.add(node.data.pubkey)
  }
  const profiles = await loadNodesByType('profile')
  for (const node of profiles) {
    if (!remainingPubkeys.has(node.data.pubkey as string)) {
      await persistence.deleteNode(node.id)
      removedIds.push(node.id)
    }
  }

  // 7. Remove orphan reaction events (no remaining shape)
  const remainingShapeIds = new Set(shapes.map((s: any) => s.id))
  for (const node of events) {
    const kind = node.data.kind as number | undefined
    if (kind && [7, 16, 9735, 1111].includes(kind)) {
      const eTags = (node.data.eTags as string[]) ?? []
      if (eTags.length && !eTags.some((eid: string) => remainingShapeIds.has(`shp:${eid}`))) {
        await persistence.deleteNode(node.id)
        removedIds.push(node.id)
      }
    }
  }

  // 8. Cap total event nodes
  const allEventIds = await persistence.allNodeIds('event')
  if (allEventIds.length > MAX_EVENT_NODES) {
    const eventNodes = await persistence.getNodes(allEventIds)
    const excessEvents = eventNodes
      .sort((a: any, b: any) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0))
      .slice(0, allEventIds.length - MAX_EVENT_NODES)
    for (const node of excessEvents) {
      await persistence.deleteNode(node.id)
      removedIds.push(node.id)
    }
  }

  self.postMessage({ type: 'pruneResult', removedIds })
}

async function handleVectorSearch(msg: { queryVec: number[]; topK: number; threshold: number; searchId: string }): Promise<void> {
  const vectors = await persistence.getAllVectors()
  const results: Array<{ id: string; score: number }> = []
  for (const { id, vector } of vectors) {
    const score = cosineSimilarity(msg.queryVec, vector)
    if (score >= msg.threshold) results.push({ id, score })
  }
  results.sort((a, b) => b.score - a.score)
  const top = results.slice(0, msg.topK)
  self.postMessage({ type: 'vectorSearchResult', searchId: msg.searchId, results: top })
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
      for (const [, entries] of subs) {
        for (const e of entries) e.close()
      }
      subs.clear()
      searchedIdsAborted.clear()
      pool.close([])
      break
    case 'pruneCache':
      void handlePruneCache()
      break
    case 'vectorSearch':
      void handleVectorSearch(msg)
      break
  }
}
