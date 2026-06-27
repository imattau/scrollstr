import { encryptValue, decryptValue } from '../lib/crypto'

export interface AppSettings {
  relays: string[]
  blossomServers: string[]
  walletString: string
  autoplay: boolean
  mutedUsers: string[]
  nsfwBlur: boolean
  nsfwPubkeys: string[]
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
}

let cachedSettings: AppSettings | null = null
let cacheTime = 0

export const loadSettings = (): AppSettings => {
  const now = Date.now()
  if (cachedSettings && now - cacheTime < 100) return cachedSettings
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    cachedSettings = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS
    cacheTime = now
  } catch (err) {
    console.error('Failed to load settings:', err)
    cachedSettings = DEFAULT_SETTINGS
  }
  return cachedSettings!
}

export const saveSettings = (settings: AppSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (err) {
    console.error('Failed to save settings:', err)
  }
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
