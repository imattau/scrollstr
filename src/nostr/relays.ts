import { useMemo } from 'react'
import { loadSettings } from '../db/local-preferences'
import { use$ } from 'applesauce-react/hooks'
import { getEventsQuery$ } from './pool'

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

  const relayListEvent = eventStore.getReplaceable(10002, pubkey)
  const relayUrls = relayListEvent?.tags?.filter(isRelayTag).map((tag: string[]) => tag[1]) ?? []

  const normalized = normalizeRelayUrls(relayUrls)
  return normalized.length > 0 ? normalized : getFallbackRelayUrls()
}

/**
 * Reactive hook that returns the logged-in user's relay list (kind:10002).
 *
 * Falls back to user-configured or default relays when no kind:10002 is in store.
 */
export const useUserRelayUrls = (eventStore: any, pubkey?: string | null): string[] => {
  // Always call use$ unconditionally (Rules of Hooks).
  const relayListEvent = use$(
    () => pubkey
      ? getEventsQuery$({ kinds: [10002], authors: [pubkey] })
      : getEventsQuery$({ kinds: [10002], authors: [] }),
    [pubkey ?? '']
  )?.[0]

  // Compute the stable relay URL list. We JSON-stringify the raw tags as the
  // useMemo key so React only produces a new array when the actual relay URLs
  // change — not on every render (which would cause dependent useEffects to
  // fire in an infinite loop).
  const rawTagsKey = relayListEvent?.tags ? JSON.stringify(relayListEvent.tags) : ''

  return useMemo(() => {
    if (!pubkey) {
      return getFallbackRelayUrls()
    }

    const relayUrls = relayListEvent?.tags?.filter(isRelayTag).map((tag: string[]) => tag[1]) ?? []
    const normalized = normalizeRelayUrls(relayUrls)
    return normalized.length > 0 ? normalized : getFallbackRelayUrls()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey, rawTagsKey])
}
