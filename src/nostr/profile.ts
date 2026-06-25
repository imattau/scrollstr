import { useEffect } from 'react'
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

// React hook to fetch creator profile reactively from Dexie cache
export const useProfile = (pubkey: string): CreatorProfile => {
  const { session } = useNostr()
  const relayUrls = useUserRelayUrls(session?.pubkey)

  const cachedProfile = useLiveQuery(async () => {
    if (!pubkey) return null
    return await db.authorProfiles.get(pubkey)
  }, [pubkey])

  useEffect(() => {
    if (!cachedProfile && pubkey) {
      console.log(`Profile not cached in Dexie for ${pubkey}, fetching from relays...`)
      const unsub = subscribeToRelays(relayUrls, { kinds: [0], authors: [pubkey], limit: 1 })
      return unsub
    }
  }, [pubkey, cachedProfile, relayUrls])

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
