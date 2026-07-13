import { useEffect, useRef, useState } from 'react'
import { subscribeToRelays, setActiveRelays } from '../../nostr/pool'
import { db } from '../../nostr/cache'
import { maybeResumeBackfill, maybeResumeProfileBackfill, maybeResumeFollowedVideoBackfill, maybeResumeFollowBackfill, maybeResumeUserVideoBackfill } from '../../nostr/cacheBackfill'

const PAGE_SIZE = 50
const LOAD_MORE_THRESHOLD = 5

interface UseFeedSubscriptionsInput {
  relayUrls: string[]
  sessionPubkey?: string
  followingPubkeys: string[]
  mutedPubkeys: Set<string>
  activeIndex: number
  videosLength: number
  oldestCreatedAt: number | undefined
  refreshKey: number
}

export function useFeedSubscriptions(input: UseFeedSubscriptionsInput): void {
  const { relayUrls, sessionPubkey, followingPubkeys, mutedPubkeys, activeIndex, videosLength, oldestCreatedAt, refreshKey } = input

  const [isFetchingOlder, setIsFetchingOlder] = useState(false)
  const lastOlderFetchAtRef = useRef(0)
  const initialBackfillsFiredRef = useRef(false)
  const prevRefreshKeyRef = useRef(refreshKey)

  // Reset backfill + subscription guards when refreshKey changes (manual refresh)
  useEffect(() => {
    if (refreshKey !== prevRefreshKeyRef.current) {
      prevRefreshKeyRef.current = refreshKey
      initialBackfillsFiredRef.current = false
    }
  }, [refreshKey])

  // Update pool relays when relayUrls resolves (only once per mount)
  useEffect(() => {
    if (relayUrls.length === 0) return
    console.log('[VideoFeed] Setting active relays:', relayUrls)
    setActiveRelays(relayUrls)
  }, [relayUrls])

  // Bootstrap user metadata from relays (once per session pubkey)
  useEffect(() => {
    if (!sessionPubkey) return
    if (initialBackfillsFiredRef.current) return

    let cancelled = false

    async function bootstrapMetadata() {
      const cached = await Promise.all([
        db.cachedEvents.where({ kind: 0, pubkey: sessionPubkey }).first(),
        db.cachedEvents.where({ kind: 3, pubkey: sessionPubkey }).first(),
        db.cachedEvents.where({ kind: 10002, pubkey: sessionPubkey }).first(),
      ])
      if (cancelled) return
      if (cached[0] && cached[1] && cached[2]) return

      const bootstrapRelays = [
        'wss://purplepag.es',
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.snort.social',
      ]
      console.log(`[VideoFeed] Fetching user metadata for ${sessionPubkey} over bootstrap relays`)
      const unsub = subscribeToRelays(bootstrapRelays, { kinds: [0, 3, 10002], authors: [sessionPubkey], limit: 3 })
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => resolve(), 1500)
        return () => { clearTimeout(timer); unsub() }
      })
    }

    void bootstrapMetadata()
    return () => { cancelled = true }
  }, [sessionPubkey])

  // Backfill: follow + user-video + general cache (once per session)
  useEffect(() => {
    if (!sessionPubkey || relayUrls.length === 0) return
    if (initialBackfillsFiredRef.current) return
    initialBackfillsFiredRef.current = true

    console.log('[VideoFeed] Firing follow & user-video backfills')
    maybeResumeFollowBackfill(relayUrls, [sessionPubkey])
    maybeResumeUserVideoBackfill(relayUrls, [sessionPubkey])

    const generalTimer = setTimeout(() => {
      void maybeResumeBackfill(relayUrls)
    }, 500)

    return () => clearTimeout(generalTimer)
  }, [sessionPubkey, relayUrls, refreshKey])

  // Profile + followed-video backfills when followingPubkeys resolves
  useEffect(() => {
    if (followingPubkeys.length === 0 || relayUrls.length === 0) return

    const timer = setTimeout(() => {
      void maybeResumeProfileBackfill(relayUrls, followingPubkeys)
      void maybeResumeFollowedVideoBackfill(relayUrls, followingPubkeys, mutedPubkeys)
    }, 500)

    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followingPubkeys, relayUrls, refreshKey])

  // Feed subscription: fetch recent videos from all relays into the cache.
  useEffect(() => {
    if (relayUrls.length === 0) return
    console.log('[VideoFeed] Fetching videos...')
    const unsub = subscribeToRelays(relayUrls, {
      kinds: [1, 21, 22, 34236],
      since: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30
    }, 'high')
    return () => { unsub() }
  }, [relayUrls, refreshKey])

  // Load more older content when approaching the end of the feed
  useEffect(() => {
    if (videosLength === 0) return
    if (activeIndex < videosLength - 1 - LOAD_MORE_THRESHOLD) return
    if (isFetchingOlder) return

    if (!oldestCreatedAt) return

    const now = Date.now()
    if (now - lastOlderFetchAtRef.current < 1500) return
    lastOlderFetchAtRef.current = now
    setIsFetchingOlder(true)

    console.log(`Loading older videos before ${oldestCreatedAt}...`)
    const unsub = subscribeToRelays(relayUrls, {
      kinds: [1, 21, 22, 34236],
      limit: PAGE_SIZE,
      until: oldestCreatedAt - 1,
    }, 'low')
    const doneTimer = setTimeout(() => setIsFetchingOlder(false), 3000)

    return () => {
      unsub()
      clearTimeout(doneTimer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, videosLength, oldestCreatedAt, relayUrls])
}
