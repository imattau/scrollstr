import NDK from '@nostr-dev-kit/ndk'
import NDKCacheAdapterDexie from '@nostr-dev-kit/cache-dexie'

// List of standard default relays to bootstrap client connection
export const DEFAULT_RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.snort.social',
  'wss://purplepag.es', // Optimized for user profiles search/lookup
]

// Initialize Dexie IndexedDB caching adapter for offline capabilities
const cacheAdapter = new NDKCacheAdapterDexie({ dbName: 'nostr-clips-cache' })

// Instantiate global NDK controller
export const ndk = new NDK({
  explicitRelayUrls: DEFAULT_RELAYS,
  cacheAdapter,
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
