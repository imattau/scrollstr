import { pool, eventStore, activeRelays } from './pool'
import {
  getCacheVideoCount,
  getCacheOldestVideoTimestamp,
  MAX_VIDEOS,
  saveEventToCache,
} from './cache'

/**
 * Batch size for each relay query.
 * Large enough to reduce round-trips but small enough not to overwhelm slow relays.
 */
const BACKFILL_BATCH_SIZE = 100

/**
 * Milliseconds to wait between batches.
 * Gives the main thread room to breathe and allows the UI to remain responsive.
 */
const BATCH_DELAY_MS = 800

/**
 * Maximum number of batches to fetch per backfill run.
 * Acts as a safety valve – at 100 events/batch × 30 batches = up to 3 000 events attempted.
 * The cache-full check will short-circuit long before this limit in practice.
 */
const MAX_BATCHES = 30

let isBackfillRunning = false

/**
 * Promisified delay.
 */
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Fetches one batch of video events from relays using nostr-tools SimplePool.querySync.
 *
 * @param relayUrls  Relay URLs to query.
 * @param until      Only return events older than this unix timestamp.
 * @returns          Array of raw Nostr events received before EOSE.
 */
async function fetchBatch(relayUrls: string[], until: number): Promise<any[]> {
  try {
    const events = await pool.querySync(relayUrls, {
      kinds: [21, 22, 34236],
      limit: BACKFILL_BATCH_SIZE,
      until,
    })
    return events
  } catch (err) {
    console.warn('[CacheBackfill] Relay error during batch fetch:', err)
    return []
  }
}

/**
 * Starts a background backfill loop that progressively loads older video events
 * from relays until:
 *   • The cache reaches MAX_VIDEOS, or
 *   • A batch returns zero events (relays have no more history), or
 *   • MAX_BATCHES iterations have been exhausted.
 *
 * Events are fed through the normal `saveEventToCache` pipeline so that:
 *   • LRU eviction keeps the cache within its size limits.
 *   • VideoShape projections stay up-to-date.
 *   • Author profiles linked to videos are updated lazily.
 *
 * The function is intentionally fire-and-forget: call it once after the local
 * IndexedDB cache has been hydrated into the EventStore.
 *
 * @param relayUrls  Relay URLs to use. Falls back to activeRelays.
 */
export async function startCacheBackfill(relayUrls?: string[]): Promise<void> {
  if (isBackfillRunning) {
    console.log('[CacheBackfill] Already running, skipping duplicate start.')
    return
  }
  isBackfillRunning = true

  const effectiveRelays: string[] =
    relayUrls && relayUrls.length > 0 ? relayUrls : activeRelays

  console.log(
    `[CacheBackfill] Starting backfill over relays: ${effectiveRelays.join(', ')}`
  )

  try {
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      // ── 1. Check remaining capacity ──────────────────────────────────────
      const currentCount = await getCacheVideoCount()
      const remaining = MAX_VIDEOS - currentCount

      if (remaining <= 0) {
        console.log(
          `[CacheBackfill] Cache is full (${currentCount}/${MAX_VIDEOS} videos). Stopping backfill.`
        )
        break
      }

      // ── 2. Determine the "until" cursor ──────────────────────────────────
      const oldestTs = await getCacheOldestVideoTimestamp()
      const until =
        oldestTs != null
          ? oldestTs - 1 // Strict exclusion so we never re-fetch the same event
          : Math.floor(Date.now() / 1000)

      console.log(
        `[CacheBackfill] Batch ${batch + 1}/${MAX_BATCHES} — ` +
          `fetching up to ${BACKFILL_BATCH_SIZE} events before ts ${until} ` +
          `(cache: ${currentCount}/${MAX_VIDEOS})`
      )

      // ── 3. Fetch from relays ─────────────────────────────────────────────
      const events = await fetchBatch(effectiveRelays, until)

      if (events.length === 0) {
        console.log(
          '[CacheBackfill] Relay returned 0 events – history exhausted. Stopping backfill.'
        )
        break
      }

      console.log(
        `[CacheBackfill] Batch ${batch + 1} received ${events.length} events from relays.`
      )

      // ── 4. Persist & project each event ─────────────────────────────────
      for (const event of events) {
        // Add to in-memory EventStore so reactive queries pick up new events
        try { eventStore.add(event) } catch (_) { /* duplicate */ }

        // Persist to IndexedDB (handles LRU eviction + VideoShape projection)
        await saveEventToCache(event)
      }

      // ── 5. Yield before next batch ───────────────────────────────────────
      await delay(BATCH_DELAY_MS)
    }
  } catch (err) {
    console.error('[CacheBackfill] Unexpected error during backfill:', err)
  } finally {
    isBackfillRunning = false
    const finalCount = await getCacheVideoCount()
    console.log(
      `[CacheBackfill] Backfill complete. Cache now holds ${finalCount} video events.`
    )
  }
}

/**
 * Convenience wrapper that re-runs the backfill whenever the relay list changes
 * (e.g. after the user's kind:10002 relay list has been resolved).
 * Only kicks off a new pass if the cache still has room for more events.
 */
export async function maybeResumeBackfill(relayUrls: string[]): Promise<void> {
  if (isBackfillRunning) return

  const currentCount = await getCacheVideoCount()
  if (currentCount >= MAX_VIDEOS) {
    console.log('[CacheBackfill] Cache already full, no resume needed.')
    return
  }

  console.log(
    `[CacheBackfill] Cache has room (${currentCount}/${MAX_VIDEOS}). Resuming backfill with updated relays.`
  )
  void startCacheBackfill(relayUrls)
}
