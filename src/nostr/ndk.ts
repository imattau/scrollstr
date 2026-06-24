import NDK from '@nostr-dev-kit/ndk'

// List of standard default relays to bootstrap client connection
export const DEFAULT_RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.snort.social',
  'wss://purplepag.es', // Optimized for user profiles search/lookup
]

// Instantiate global NDK controller (no cache adapter — the app manages
// its own IndexedDB cache via cache.ts to avoid redundant storage)
export const ndk = new NDK({
  explicitRelayUrls: DEFAULT_RELAYS,
})

// Establish connections to relays
export const initNdk = async () => {
  try {
    console.log('Connecting to Nostr relays...')
    await ndk.connect(2000) // Connect with 2 second timeout per relay
    console.log('NDK connected successfully')
  } catch (error) {
    console.error('Error during NDK connection:', error)
  }
}
