import { encryptValue, decryptValue } from '../lib/crypto'

export interface AppSettings {
  relays: string[]
  blossomServers: string[]
  walletString: string
  autoplay: boolean
  mutedUsers: string[]
  nsfwBlur: boolean
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
