import { backfillWorker } from './pool'

let isBackfillRunning = false

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
