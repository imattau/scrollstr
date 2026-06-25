import { backfillWorker } from './pool'
import { db } from './cache'

let isBackfillRunning = false
let isProfileBackfillRunning = false

/**
 * Starts a background backfill in the web worker.
 * The worker iterates relays, fetches historical video events via
 * pool.querySync, and sends them back to the main thread for caching.
 *
 * Safe to call multiple times – duplicate starts are ignored.
 */
export function startCacheBackfill(relayUrls?: string[]): void {
  if (isBackfillRunning) {
    console.log('[CacheBackfill] Already running, skipping duplicate start.')
    return
  }
  isBackfillRunning = true

  const handleComplete = (e: MessageEvent) => {
    if (e.data.type === 'backfillComplete') {
      isBackfillRunning = false
      backfillWorker.removeEventListener('message', handleComplete)
    }
  }
  backfillWorker.addEventListener('message', handleComplete)

  backfillWorker.postMessage({
    type: 'startBackfill',
    relayUrls: relayUrls ?? [],
  })
}

/**
 * Sends a resume-backfill signal to the worker if no pass is currently running.
 * The worker checks cache capacity internally before proceeding.
 */
export function maybeResumeBackfill(relayUrls: string[]): void {
  if (isBackfillRunning) return
  startCacheBackfill(relayUrls)
}

/**
 * Collects uncached profile pubkeys and starts a profile backfill in the worker.
 * Fetches kind:0 events for pubkeys from video creators and followed users.
 */
export async function startProfileBackfill(relayUrls: string[], knownPubkeys: string[]): Promise<void> {
  if (isProfileBackfillRunning) return
  if (knownPubkeys.length === 0) return

  // Filter out already-cached profiles
  const cached = new Set(
    (await db.authorProfiles.where('pubkey').anyOf(knownPubkeys).primaryKeys())
  )
  const uncached = knownPubkeys.filter((pk) => !cached.has(pk))
  if (uncached.length === 0) {
    console.log('[CacheBackfill] All profiles already cached.')
    return
  }

  isProfileBackfillRunning = true

  const handleComplete = (e: MessageEvent) => {
    if (e.data.type === 'profileBackfillComplete') {
      isProfileBackfillRunning = false
      backfillWorker.removeEventListener('message', handleComplete)
    }
  }
  backfillWorker.addEventListener('message', handleComplete)

  backfillWorker.postMessage({
    type: 'startProfileBackfill',
    relayUrls,
    pubkeys: uncached,
  })
}

/**
 * Triggers profile backfill for known pubkeys only if one isn't running.
 */
export async function maybeResumeProfileBackfill(relayUrls: string[], knownPubkeys: string[]): Promise<void> {
  if (isProfileBackfillRunning) return
  await startProfileBackfill(relayUrls, knownPubkeys)
}
