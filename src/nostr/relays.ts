import { useMemo } from 'react'
import { loadSettings } from '../db/local-preferences'
import { graph, useGraphQuery } from '../graph'

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

/**
 * Reactive hook that returns the logged-in user's relay list (kind:10002).
 *
 * Falls back to user-configured or default relays when no kind:10002 is in store.
 */
export const useUserRelayUrls = (pubkey?: string | null): string[] => {
  const rawRelayEvent = useGraphQuery(
    () => {
      if (!pubkey) return undefined
      const node = graph.byKindPubkey(10002, pubkey)
      return (node?.data as { event?: { tags: string[][] } } | undefined)?.event
    },
    [pubkey],
    200,
    ['event'] as any,
  )

  const rawTagsKey = rawRelayEvent?.tags ? JSON.stringify(rawRelayEvent.tags) : ''

  return useMemo(() => {
    if (!pubkey) {
      return getFallbackRelayUrls()
    }

    const relayUrls = rawRelayEvent?.tags?.filter(isRelayTag).map((tag: string[]) => tag[1]) ?? []
    const normalized = normalizeRelayUrls(relayUrls)
    return normalized.length > 0 ? normalized : getFallbackRelayUrls()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey, rawTagsKey])
}
