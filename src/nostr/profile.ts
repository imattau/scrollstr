import { useEffect } from 'react'
import { merge } from 'rxjs'
import { map, startWith } from 'rxjs/operators'
import { createRxForwardReq } from 'rx-nostr'
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

// React hook to fetch creator profile reactively and cache it
export const useProfile = (pubkey: string): CreatorProfile => {
  const { rxNostr, eventStore, session } = useNostr()
  const relayUrls = useUserRelayUrls(eventStore, session?.pubkey)
  const profileEvent = use$(() => getProfileQuery$(eventStore, pubkey), [pubkey])

  useEffect(() => {
    if (!profileEvent && pubkey) {
      console.log(`Profile event not cached for ${pubkey}, fetching from relays...`)
      const rxReq = createRxForwardReq()
      const sub = rxNostr.use(rxReq, { relays: relayUrls }).subscribe()
      rxReq.emit({ kinds: [0], authors: [pubkey], limit: 1 })
      return () => {
        sub.unsubscribe()
      }
    }
  }, [pubkey, profileEvent, rxNostr, relayUrls])

  return parseProfileContent(profileEvent, pubkey)
}
