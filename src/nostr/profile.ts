import { useEffect } from 'react'
import { merge } from 'rxjs'
import { map, startWith } from 'rxjs/operators'
import { subscribeToRelays } from './pool'
import { useNostr } from '../app/providers'
import { use$ } from 'applesauce-react/hooks'
import { CreatorProfile } from '../features/feed/VideoFeedItem'
import { useUserRelayUrls } from './relays'

// Query the eventStore for replaceable kind:0 event for a pubkey
export const getProfileQuery$ = (eventStore: any, pubkey: string) => {
  return merge(eventStore.insert$, eventStore.update$).pipe(
    startWith(null),
    map(() => eventStore.getReplaceable(0, pubkey))
  )
}

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

import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './cache'

// React hook to fetch creator profile reactively and cache it
export const useProfile = (pubkey: string): CreatorProfile => {
  const { eventStore, session } = useNostr()
  const relayUrls = useUserRelayUrls(eventStore, session?.pubkey)
  const profileEvent = use$(() => getProfileQuery$(eventStore, pubkey), [pubkey])

  // Reactively query Dexie's authorProfiles cache table
  const cachedProfile = useLiveQuery(async () => {
    if (!pubkey) return null
    return await db.authorProfiles.get(pubkey)
  }, [pubkey])

  useEffect(() => {
    // Only fetch if profile is not available in both EventStore AND Dexie cache
    if (!profileEvent && !cachedProfile && pubkey) {
      console.log(`Profile event not cached in memory or Dexie for ${pubkey}, fetching from relays...`)
      const unsub = subscribeToRelays(relayUrls, { kinds: [0], authors: [pubkey], limit: 1 })
      return unsub
    }
  }, [pubkey, profileEvent, cachedProfile, relayUrls])

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

  return parseProfileContent(profileEvent, pubkey)
}
