import { getBackfillWorker } from './pool'
import { graph } from '../graph'

type BackfillCompleteEvent =
  | 'backfillComplete'
  | 'profileBackfillComplete'
  | 'followedVideoBackfillComplete'
  | 'followBackfillComplete'
  | 'userVideoBackfillComplete'

type BackfillStartType =
  | 'startBackfill'
  | 'startProfileBackfill'
  | 'startFollowedVideoBackfill'
  | 'startFollowBackfill'
  | 'startUserVideoBackfill'

interface BackfillConfig {
  flag: { current: boolean }
  startType: BackfillStartType
  completeType: BackfillCompleteEvent
  logName: string
}

const activeBackfillListeners = new Set<(e: MessageEvent) => void>()

function createBackfillRunner(config: BackfillConfig) {
  function start(message: Record<string, any>): void {
    if (config.flag.current) {
      console.log(`[CacheBackfill] ${config.logName} already running, skipping.`)
      return
    }
    config.flag.current = true

    const handleComplete = (e: MessageEvent) => {
      if (e.data.type === config.completeType) {
        config.flag.current = false
        getBackfillWorker().removeEventListener('message', handleComplete)
        activeBackfillListeners.delete(handleComplete)
      }
    }
    activeBackfillListeners.add(handleComplete)
    getBackfillWorker().addEventListener('message', handleComplete)

    getBackfillWorker().postMessage({ type: config.startType, ...message })
  }

  function maybeResume(message: Record<string, any>): void {
    if (config.flag.current) return
    start(message)
  }

  function forceRestart(message: Record<string, any>): void {
    config.flag.current = false
    start(message)
  }

  return { start, maybeResume, forceRestart }
}

/** Reset all backfill flags and remove orphaned worker message listeners. */
export function resetBackfillState(): void {
  for (const listener of activeBackfillListeners) {
    getBackfillWorker().removeEventListener('message', listener)
  }
  activeBackfillListeners.clear()
  for (const flag of Object.values(backfillFlags)) {
    flag.current = false
  }
}

const backfillFlags = {
  general: { current: false },
  profile: { current: false },
  followedVideo: { current: false },
  follow: { current: false },
  userVideo: { current: false },
}

const generalBackfill = createBackfillRunner({
  flag: backfillFlags.general,
  startType: 'startBackfill',
  completeType: 'backfillComplete',
  logName: 'General cache backfill',
})

const profileBackfill = createBackfillRunner({
  flag: backfillFlags.profile,
  startType: 'startProfileBackfill',
  completeType: 'profileBackfillComplete',
  logName: 'Profile backfill',
})

const followedVideoBackfill = createBackfillRunner({
  flag: backfillFlags.followedVideo,
  startType: 'startFollowedVideoBackfill',
  completeType: 'followedVideoBackfillComplete',
  logName: 'Followed-video backfill',
})

const followBackfill = createBackfillRunner({
  flag: backfillFlags.follow,
  startType: 'startFollowBackfill',
  completeType: 'followBackfillComplete',
  logName: 'Follow backfill',
})

const userVideoBackfill = createBackfillRunner({
  flag: backfillFlags.userVideo,
  startType: 'startUserVideoBackfill',
  completeType: 'userVideoBackfillComplete',
  logName: 'User-video backfill',
})

export function startCacheBackfill(relayUrls?: string[]): void {
  generalBackfill.start({ relayUrls: relayUrls ?? [] })
}

export function maybeResumeBackfill(relayUrls: string[]): void {
  generalBackfill.maybeResume({ relayUrls })
}

export function forceRestartBackfill(relayUrls: string[]): void {
  generalBackfill.forceRestart({ relayUrls })
}

export async function startProfileBackfill(relayUrls: string[], knownPubkeys: string[]): Promise<void> {
  if (backfillFlags.profile.current) return
  if (knownPubkeys.length === 0) return

  const cached = new Set(
    knownPubkeys.filter(pk => graph.getNode(`pro:${pk}`))
  )
  const uncached = knownPubkeys.filter((pk) => !cached.has(pk))
  if (uncached.length === 0) {
    console.log('[CacheBackfill] All profiles already cached.')
    return
  }

  profileBackfill.start({ relayUrls, pubkeys: uncached })
}

export async function maybeResumeProfileBackfill(relayUrls: string[], knownPubkeys: string[]): Promise<void> {
  if (backfillFlags.profile.current) return
  await startProfileBackfill(relayUrls, knownPubkeys)
}

export async function startFollowedVideoBackfill(relayUrls: string[], followedPubkeys: string[], mutedPubkeys?: Set<string>): Promise<void> {
  if (backfillFlags.followedVideo.current) return
  if (followedPubkeys.length === 0) return

  const targetPubkeys = mutedPubkeys?.size
    ? followedPubkeys.filter(pk => !mutedPubkeys.has(pk))
    : followedPubkeys

  if (targetPubkeys.length === 0) return

  const counts = new Map<string, number>()
  for (const pk of targetPubkeys) {
    const shapes = graph.byPubkey(pk, 'video_shape')
    const validCount = shapes.filter(n => (n.data as Record<string, unknown>).mediaStatus !== 'failed').length
    if (validCount >= 3) continue
    counts.set(pk, validCount)
  }
  const uncached = targetPubkeys.filter(pk => (counts.get(pk) ?? 0) < 3)

  if (uncached.length === 0) {
    console.log('[CacheBackfill] All followed pubkeys already have cached videos.')
    return
  }

  followedVideoBackfill.start({ relayUrls, pubkeys: uncached })
}

export async function maybeResumeFollowedVideoBackfill(relayUrls: string[], followedPubkeys: string[], mutedPubkeys?: Set<string>): Promise<void> {
  if (backfillFlags.followedVideo.current) return
  await startFollowedVideoBackfill(relayUrls, followedPubkeys, mutedPubkeys)
}

export function startFollowBackfill(relayUrls: string[], pubkeys: string[]): void {
  if (backfillFlags.follow.current) return
  if (pubkeys.length === 0) return
  followBackfill.start({ relayUrls, pubkeys })
}

export function maybeResumeFollowBackfill(relayUrls: string[], pubkeys: string[]): void {
  if (backfillFlags.follow.current) return
  startFollowBackfill(relayUrls, pubkeys)
}

export function startUserVideoBackfill(relayUrls: string[], pubkeys: string[]): void {
  if (backfillFlags.userVideo.current) return
  if (pubkeys.length === 0) return
  userVideoBackfill.start({ relayUrls, pubkeys })
}

export function maybeResumeUserVideoBackfill(relayUrls: string[], pubkeys: string[]): void {
  if (backfillFlags.userVideo.current) return
  startUserVideoBackfill(relayUrls, pubkeys)
}
