export interface AppSettings {
  relays: string[]
  blossomServers: string[]
  walletString: string
  autoplay: boolean
  mutedUsers: string[]
  nsfwBlur: boolean
}

const STORAGE_KEY = 'nostr-clips-settings'

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
