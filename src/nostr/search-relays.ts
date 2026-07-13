const KNOWN_SEARCH_RELAYS = [
  'wss://relay.nostr.band',
  'wss://search.nos.today',
  'wss://nostr.wine',
]

const discoveredRelays: string[] = []

let directoryCache: string[] = []
let lastDirectoryFetch = 0
const DIRECTORY_CACHE_TTL = 60 * 60 * 1000

export function addDiscoveredRelays(urls: string[]): void {
  for (const url of urls) {
    const normalized = url.trim()
    if (normalized && !discoveredRelays.includes(normalized)) {
      discoveredRelays.push(normalized)
    }
  }
}

export async function fetchRelayDirectory(): Promise<string[]> {
  const now = Date.now()
  if (lastDirectoryFetch > 0 && now - lastDirectoryFetch < DIRECTORY_CACHE_TTL) {
    return directoryCache
  }
  try {
    const res = await fetch('https://api.nostr.watch/v1/online')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data: any = await res.json()
    const urls: string[] = (Array.isArray(data) ? data : [])
      .map((r: any) => (typeof r === 'string' ? r : r.url))
      .filter((u: string): u is string => typeof u === 'string' && (u.startsWith('wss://') || u.startsWith('ws://')))
    directoryCache = urls
    lastDirectoryFetch = now
    addDiscoveredRelays(urls)
    return urls
  } catch (err) {
    console.warn('[SearchRelays] Failed to fetch relay directory:', err)
    return directoryCache
  }
}

export function getSearchRelays(userRelays: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const url of userRelays) {
    if (!seen.has(url)) { seen.add(url); result.push(url) }
  }
  for (const url of KNOWN_SEARCH_RELAYS) {
    if (!seen.has(url)) { seen.add(url); result.push(url) }
  }
  for (const url of discoveredRelays) {
    if (!seen.has(url)) { seen.add(url); result.push(url) }
  }

  return result
}
