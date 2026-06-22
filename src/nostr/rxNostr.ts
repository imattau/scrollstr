import { createRxNostr } from 'rx-nostr'
import { EventStore } from 'applesauce-core'

// List of standard default relays to bootstrap client connection
export const DEFAULT_RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.snort.social',
  'wss://purplepag.es', // Optimized for user profiles search/lookup
]

// Initialize the global rx-nostr client
export const rxNostr = createRxNostr()
rxNostr.setDefaultRelays(DEFAULT_RELAYS)

// Initialize global Applesauce EventStore
export const eventStore = new EventStore()

// Listen to all events received on rx-nostr connections and add them to eventStore
rxNostr.createAllEventObservable().subscribe((packet) => {
  eventStore.add(packet.event as any)
})

import { merge } from 'rxjs'
import { map, startWith } from 'rxjs/operators'

export const getEventsQuery$ = (filters: any) => {
  return merge(eventStore.insert$, eventStore.update$, eventStore.remove$).pipe(
    startWith(null),
    map(() => eventStore.getByFilters(filters))
  )
}
