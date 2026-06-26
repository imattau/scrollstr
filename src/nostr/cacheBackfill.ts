import { backfillWorker } from './pool'
import { db } from './cache'

let isBackfillRunning = false
let isProfileBackfillRunning = false
let isFollowedVideoBackfillRunning = false
let isFollowBackfillRunning = false
let isUserVideoBackfillRunning = false

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
 * Force-restarts backfill even if one is already running.
 * Resets the running guard and starts a fresh pass with the given relays.
 */
export function forceRestartBackfill(relayUrls: string[]): void {
  isBackfillRunning = false
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

/**
 * Starts a background backfill for video events from followed pubkeys.
 * Fetches video events (kinds 21, 22, 34236) scoped to specific authors
 * so the Following feed is populated quickly.
 */
export function startFollowedVideoBackfill(relayUrls: string[], followedPubkeys: string[]): void {
  if (isFollowedVideoBackfillRunning) {
    console.log('[CacheBackfill] Followed-video backfill already running, skipping.')
    return
  }
  if (followedPubkeys.length === 0) return

  isFollowedVideoBackfillRunning = true

  const handleComplete = (e: MessageEvent) => {
    if (e.data.type === 'followedVideoBackfillComplete') {
      isFollowedVideoBackfillRunning = false
      backfillWorker.removeEventListener('message', handleComplete)
    }
  }
  backfillWorker.addEventListener('message', handleComplete)

  backfillWorker.postMessage({
    type: 'startFollowedVideoBackfill',
    relayUrls,
    pubkeys: followedPubkeys,
  })
}

/**
 * Triggers followed-video backfill only if one isn't already running.
 */
export function maybeResumeFollowedVideoBackfill(relayUrls: string[], followedPubkeys: string[]): void {
  if (isFollowedVideoBackfillRunning) return
  startFollowedVideoBackfill(relayUrls, followedPubkeys)
}

/**
 * Backfills kind:3 (contact list / follow) events for specific pubkeys.
 * This ensures the user's up-to-date following list is cached so the
 * Following feed can correctly determine which pubkeys to query.
 */
export function startFollowBackfill(relayUrls: string[], pubkeys: string[]): void {
  if (isFollowBackfillRunning) {
    console.log('[CacheBackfill] Follow backfill already running, skipping.')
    return
  }
  if (pubkeys.length === 0) return

  isFollowBackfillRunning = true

  const handleComplete = (e: MessageEvent) => {
    if (e.data.type === 'followBackfillComplete') {
      isFollowBackfillRunning = false
      backfillWorker.removeEventListener('message', handleComplete)
    }
  }
  backfillWorker.addEventListener('message', handleComplete)

  backfillWorker.postMessage({
    type: 'startFollowBackfill',
    relayUrls,
    pubkeys,
  })
}

export function maybeResumeFollowBackfill(relayUrls: string[], pubkeys: string[]): void {
  if (isFollowBackfillRunning) return
  startFollowBackfill(relayUrls, pubkeys)
}

/**
 * Backfills video events (kinds 1, 21, 22, 34236) for the current user's
 * own pubkey(s). Ensures the user sees their own content in the feed.
 */
export function startUserVideoBackfill(relayUrls: string[], pubkeys: string[]): void {
  if (isUserVideoBackfillRunning) {
    console.log('[CacheBackfill] User-video backfill already running, skipping.')
    return
  }
  if (pubkeys.length === 0) return

  isUserVideoBackfillRunning = true

  const handleComplete = (e: MessageEvent) => {
    if (e.data.type === 'userVideoBackfillComplete') {
      isUserVideoBackfillRunning = false
      backfillWorker.removeEventListener('message', handleComplete)
    }
  }
  backfillWorker.addEventListener('message', handleComplete)

  backfillWorker.postMessage({
    type: 'startUserVideoBackfill',
    relayUrls,
    pubkeys,
  })
}

export function maybeResumeUserVideoBackfill(relayUrls: string[], pubkeys: string[]): void {
  if (isUserVideoBackfillRunning) return
  startUserVideoBackfill(relayUrls, pubkeys)
}
