import { encryptValue, decryptValue } from '../lib/crypto'

export interface AppSettings {
  relays: string[]
  blossomServers: string[]
  walletString: string
  autoplay: boolean
  mutedUsers: string[]
  nsfwBlur: boolean
  nsfwPubkeys: string[]
  autoScroll: boolean
  autoRotateLandscape: boolean
}

const STORAGE_KEY = 'nostr-clips-settings'
const WALLET_ENCRYPTION_PREFIX = 'enc:'

const DEFAULT_SETTINGS: AppSettings = {
  relays: [
    'wss://nos.lol',
    'wss://relay.damus.io',
    'wss://relay.snort.social',
    'wss://purplepag.es',
  ],
  blossomServers: [
    'https://blossom.damus.io',
    'https://media.nostr.band',
  ],
  walletString: '',
  autoplay: true,
  mutedUsers: [],
  nsfwBlur: true,
  nsfwPubkeys: [],
  autoScroll: true,
  autoRotateLandscape: false,
}

const SETTINGS_CHANGED_EVENT = 'scrollstr-settings-changed'

let cachedSettings: AppSettings | null = null

const loadRawSettings = (): AppSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export const loadSettings = (): AppSettings => {
  if (cachedSettings) return cachedSettings
  cachedSettings = loadRawSettings()
  return cachedSettings
}

export const saveSettings = (settings: AppSettings): void => {
  cachedSettings = settings
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (err) {
    console.error('Failed to save settings:', err)
  }
  window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT))
}

// Listen for settings changes from other tabs and invalidate cache.
// Named so it can be removed (e.g. on HMR in dev) instead of an anonymous
// closure that would accumulate across reloads.
const onStorageEvent = (e: StorageEvent) => {
  if (e.key === STORAGE_KEY) {
    cachedSettings = null
  }
}
window.addEventListener('storage', onStorageEvent)

/** Remove the cross-tab storage listener. Intended for tests / HMR dispose. */
export function removeSettingsStorageListener(): void {
  window.removeEventListener('storage', onStorageEvent)
}

// Vite HMR: dispose the previous module's listener on hot reload so we
// don't accumulate one listener per reload in dev.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener('storage', onStorageEvent)
  })
}

// Fields that have their own dedicated Nostr event kinds and are excluded from the
// encrypted kind-30078 app-settings blob.
const NOSTR_SYNC_EXCLUDE = new Set([
  'relays',         // kind-10002 relay list
  'blossomServers', // kind-10063 blossom list
  'walletString',   // encrypted locally via AES-GCM
  'mutedUsers',     // kind-10000 mute list
])

export function getNostrSyncableSettings(settings: AppSettings): Partial<AppSettings> {
  const result: Record<string, any> = {}
  for (const key of Object.keys(settings) as (keyof AppSettings)[]) {
    if (!NOSTR_SYNC_EXCLUDE.has(key)) {
      result[key] = settings[key]
    }
  }
  return result as Partial<AppSettings>
}

export function mergeSettings(
  target: AppSettings,
  source: Partial<AppSettings>
): AppSettings {
  return { ...target, ...source }
}

export async function loadWalletString(): Promise<string> {
  const s = loadSettings()
  if (!s.walletString) return ''
  if (s.walletString.startsWith(WALLET_ENCRYPTION_PREFIX)) {
    try {
      return await decryptValue(s.walletString.slice(WALLET_ENCRYPTION_PREFIX.length))
    } catch {
      return ''
    }
  }
  return s.walletString
}

export async function saveWalletString(walletString: string): Promise<void> {
  const s = loadSettings()
  if (walletString) {
    const encrypted = await encryptValue(walletString)
    s.walletString = WALLET_ENCRYPTION_PREFIX + encrypted
  } else {
    s.walletString = ''
  }
  saveSettings(s)
}
