import { loadSettings } from '../db/local-preferences'
import { use$ } from 'applesauce-react/hooks'
import { getEventsQuery$ } from './rxNostr'

const DEFAULT_RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.snort.social',
  'wss://purplepag.es',
]

const isRelayTag = (tag: string[]) => tag[0] === 'r' && typeof tag[1] === 'string'

const normalizeRelayUrls = (relays: string[]) => {
  const seen = new Set<string>()
  const cleaned: string[] = []

  for (const relay of relays) {
    const trimmed = relay.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    cleaned.push(trimmed)
  }

  return cleaned
}

export const getFallbackRelayUrls = (): string[] => {
  const settings = loadSettings()
  return normalizeRelayUrls(settings.relays.length > 0 ? settings.relays : DEFAULT_RELAYS)
}

export const getUserRelayUrls = (eventStore: any, pubkey?: string | null): string[] => {
  if (!pubkey) {
    return getFallbackRelayUrls()
  }

  const relayListEvent = eventStore.getByFilters({ kinds: [10002], authors: [pubkey] })?.[0]
  const relayUrls = relayListEvent?.tags?.filter(isRelayTag).map((tag: string[]) => tag[1]) ?? []

  const normalized = normalizeRelayUrls(relayUrls)
  return normalized.length > 0 ? normalized : getFallbackRelayUrls()
}

export const useUserRelayUrls = (eventStore: any, pubkey?: string | null): string[] => {
  // If no pubkey, return fallback immediately without querying
  if (!pubkey) {
    return getFallbackRelayUrls()
  }

  const relayListEvent = use$(
    () => getEventsQuery$({ kinds: [10002], authors: [pubkey] }),
    [pubkey]
  )?.[0]

  const relayUrls = relayListEvent?.tags?.filter(isRelayTag).map((tag: string[]) => tag[1]) ?? []
  const normalized = normalizeRelayUrls(relayUrls)

  if (normalized.length > 0) {
    console.log(`[Relays] Found user relay list (kind 10002) for ${pubkey}:`, normalized)
    return normalized
  }

  const fallback = getUserRelayUrls(eventStore, pubkey)
  console.log(`[Relays] No kind 10002 found for ${pubkey}, using fallback:`, fallback)
  return fallback
}
