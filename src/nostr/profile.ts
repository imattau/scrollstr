import { useEffect, useRef } from 'react'
import { subscribeToRelays } from './pool'
import { useNostr } from '../app/providers'
import { useUserRelayUrls } from './relays'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './cache'
import type { CreatorProfile } from '../features/feed/VideoFeedItem'

// Parse metadata JSON content from kind:0 event
export const parseProfileContent = (profileEvent: any, pubkey: string): CreatorProfile => {
  if (!profileEvent) {
    return {
      pubkey,
      name: pubkey.slice(0, 8),
      displayName: pubkey.slice(0, 8),
      isVerified: false,
    }
  }

  try {
    const data = JSON.parse(profileEvent.content)
    const name = data.name || data.display_name || pubkey.slice(0, 8)
    return {
      pubkey,
      name,
      displayName: data.display_name || name,
      picture: data.picture || data.image,
      nip05: data.nip05,
      isVerified: !!data.nip05,
      about: data.about,
      website: data.website,
    }
  } catch (e) {
    console.error('Failed to parse profile content:', e)
    return {
      pubkey,
      name: pubkey.slice(0, 8),
      displayName: pubkey.slice(0, 8),
      isVerified: false,
    }
  }
}

// ── Batched profile subscription ───────────────────────────────────────
// Instead of one subscription per useProfile instance, collect all
// uncached pubkeys and subscribe once. Events flow through saveEventToCache
// and useLiveQuery reactively updates each hook.

const pendingPubkeys = new Set<string>()
let batchTimer: ReturnType<typeof setTimeout> | null = null
let batchUnsub: (() => void) | null = null

function flushBatch(relayUrls: string[]) {
  if (pendingPubkeys.size === 0) return

  const pubkeys = Array.from(pendingPubkeys)
  pendingPubkeys.clear()

  if (batchUnsub) batchUnsub()
  batchUnsub = subscribeToRelays(relayUrls, {
    kinds: [0],
    authors: pubkeys,
    limit: 1,
  })
}

function scheduleProfileFetch(pubkey: string, relayUrls: string[]) {
  pendingPubkeys.add(pubkey)
  if (batchTimer) clearTimeout(batchTimer)
  batchTimer = setTimeout(() => flushBatch(relayUrls), 100)
}

function cancelProfileFetch(pubkey: string) {
  pendingPubkeys.delete(pubkey)
  if (pendingPubkeys.size === 0 && batchTimer) {
    clearTimeout(batchTimer)
    batchTimer = null
  }
}

// React hook to fetch creator profile reactively from Dexie cache
export const useProfile = (pubkey: string): CreatorProfile => {
  const { session } = useNostr()
  const relayUrls = useUserRelayUrls(session?.pubkey)
  const relayUrlsRef = useRef(relayUrls)
  relayUrlsRef.current = relayUrls
  const pubkeyRef = useRef(pubkey)
  pubkeyRef.current = pubkey

  const cachedProfile = useLiveQuery(async () => {
    if (!pubkey) return null
    return await db.authorProfiles.get(pubkey)
  }, [pubkey])

  useEffect(() => {
    if (!cachedProfile && pubkey) {
      scheduleProfileFetch(pubkey, relayUrlsRef.current)
    }
    return () => {
      cancelProfileFetch(pubkeyRef.current)
    }
  }, [pubkey, cachedProfile])

  if (cachedProfile) {
    return {
      pubkey,
      name: cachedProfile.name,
      displayName: cachedProfile.displayName || cachedProfile.name,
      picture: cachedProfile.picture,
      nip05: cachedProfile.nip05,
      isVerified: cachedProfile.isVerified,
      about: cachedProfile.about,
      website: cachedProfile.website
    }
  }

  return parseProfileContent(null, pubkey)
}
