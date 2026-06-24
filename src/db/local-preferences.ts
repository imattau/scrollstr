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

export const loadSettings = (): AppSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch (err) {
    console.error('Failed to load settings:', err)
    return DEFAULT_SETTINGS
  }
}

export const saveSettings = (settings: AppSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (err) {
    console.error('Failed to save settings:', err)
  }
}
