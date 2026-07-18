let _onDiscoveredChange: (() => void) | null = null

export function setOnDiscoveredChange(cb: () => void): void {
  _onDiscoveredChange = cb
}

const KNOWN_SEARCH_RELAYS = [
  'wss://relay.nostr.band',
  'wss://search.nos.today',
  'wss://nostr.wine',
]

const discoveredRelays: string[] = []
const MAX_DISCOVERED = 25

let directoryCache: string[] = []
let lastDirectoryFetch = 0
let lastDirectoryFetchAttempt = 0
const DIRECTORY_CACHE_TTL = 60 * 60 * 1000
const FAILURE_RETRY_INTERVAL = 5 * 60 * 1000

// Persist last fetch attempt across page refreshes so a broken API doesn't
// log on every mount cycle.
try { lastDirectoryFetchAttempt = Number(localStorage.getItem('scrollstr_last_relay_fetch') ?? 0) } catch {}

// ── NIP-50 capability cache ──────────────────────────────────────────────

const nip50Capable = new Set<string>()
const nip50Checked = new Set<string>()
const NIP11_CACHE_TTL = 6 * 60 * 60 * 1000 // 6 hours
const nip11Cache = new Map<string, { expires: number }>()
// Cap the NIP-11 / NIP-50 metadata caches so a large relay directory fetch
// (thousands of URLs) can't accumulate stale entries indefinitely. The cap
// is 4× MAX_DISCOVERED for headroom — entries beyond the cap are evicted in
// LRU order (Map insertion order). Evicted relays simply re-fetch on demand
// if they re-enter discoveredRelays later.
const NIP_CACHE_MAX = MAX_DISCOVERED * 4

function evictNipCaches(): void {
  // Drop expired nip11Cache entries first (cheap opportunistic purge).
  const now = Date.now()
  for (const [url, entry] of nip11Cache) {
    if (entry.expires <= now) {
      nip11Cache.delete(url)
      nip50Checked.delete(url)
      nip50Capable.delete(url)
    }
  }
  // Then enforce size cap on still-valid entries (LRU = Map insertion order).
  while (nip11Cache.size > NIP_CACHE_MAX) {
    const oldest = nip11Cache.keys().next().value
    if (oldest === undefined) break
    nip11Cache.delete(oldest)
  }
  // Cap nip50Checked separately (it may hold entries whose nip11 fetch failed).
  while (nip50Checked.size > NIP_CACHE_MAX) {
    const oldest = nip50Checked.keys().next().value
    if (oldest === undefined) break
    nip50Checked.delete(oldest)
  }
}

async function checkNip50Support(relayUrl: string): Promise<boolean> {
  if (KNOWN_SEARCH_RELAYS.includes(relayUrl)) return true
  if (nip50Capable.has(relayUrl)) return true
  if (nip50Checked.has(relayUrl)) return false

  const cached = nip11Cache.get(relayUrl)
  if (cached && cached.expires > Date.now()) return nip50Capable.has(relayUrl)

  try {
    const httpUrl = relayUrl.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:')
    const res = await fetch(httpUrl, { method: 'GET', signal: AbortSignal.timeout(3000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const doc: any = await res.json()
    const supportsNip50 = Array.isArray(doc?.supported_nips) && doc.supported_nips.includes(50)
    if (supportsNip50) nip50Capable.add(relayUrl)
    // Refresh insertion order (LRU touch).
    nip11Cache.delete(relayUrl)
    nip11Cache.set(relayUrl, { expires: Date.now() + NIP11_CACHE_TTL })
    nip50Checked.delete(relayUrl)
    nip50Checked.add(relayUrl)
    return supportsNip50
  } catch {
    nip50Checked.delete(relayUrl)
    nip50Checked.add(relayUrl)
    return false
  } finally {
    evictNipCaches()
  }
}

export function addDiscoveredRelays(urls: string[]): void {
  let changed = false
  for (const url of urls) {
    const normalized = url.trim()
    if (!normalized || discoveredRelays.includes(normalized)) continue
    if (discoveredRelays.length >= MAX_DISCOVERED) {
      // Only drop the URL from the small rotating "active discovery" window
      // here. Do NOT wipe its NIP-50/NIP-11 check result — the same popular
      // relay hosts recur across many users' kind:10002 lists, so evicting
      // that memory just because a host briefly cycled out of the top-25
      // window causes it to be re-fetched (and, if unreachable, re-failed)
      // every time it cycles back in. evictNipCaches() below is the actual
      // cache-eviction mechanism (its own size cap, NIP_CACHE_MAX) and TTL.
      discoveredRelays.shift()
    }
    discoveredRelays.push(normalized)
    changed = true
    // Fire-and-forget NIP-50 check; results used in getSearchRelays
    checkNip50Support(normalized).catch(() => {})
  }
  if (changed) {
    evictNipCaches()
    _onDiscoveredChange?.()
  }
}

export async function fetchRelayDirectory(): Promise<string[]> {
  const now = Date.now()
  if (lastDirectoryFetch > 0 && now - lastDirectoryFetch < DIRECTORY_CACHE_TTL) {
    return directoryCache
  }
  // Rate-limit retry on failure so repeated mount cycles don't spam failed requests
  if (now - lastDirectoryFetchAttempt < FAILURE_RETRY_INTERVAL) {
    return directoryCache
  }
  lastDirectoryFetchAttempt = now
  try { localStorage.setItem('scrollstr_last_relay_fetch', String(now)) } catch {}
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
  } catch {
    return directoryCache
  }
}

export const DEFAULT_SEARCH_LIMIT = 50

const MAX_QUERY_LENGTH = 200

export function sanitizeSearchQuery(query: string): string {
  return query
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
    .replace(/\p{C}/gu, '')
    .replace(/\s+/g, ' ')
}

export function getSearchRelays(userRelays: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const url of userRelays) {
    if (seen.has(url)) continue
    seen.add(url)
    if (nip50Capable.has(url) || KNOWN_SEARCH_RELAYS.includes(url)) {
      result.push(url)
    } else if (!nip50Checked.has(url)) {
      checkNip50Support(url).catch(() => {})
    }
  }
  for (const url of KNOWN_SEARCH_RELAYS) {
    if (!seen.has(url)) { seen.add(url); result.push(url) }
  }
  for (const url of discoveredRelays) {
    if (seen.has(url)) continue
    if (nip50Capable.has(url)) {
      seen.add(url); result.push(url)
    }
  }

  return result
}

/** Search-only relay list — omits user personal relays entirely so searches
 *  only go to known search relays and confirmed NIP-50 capable relays.
 *  Use this for NIP-50 search queries instead of getSearchRelays(userRelays). */
export function getSearchOnlyRelays(): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const url of KNOWN_SEARCH_RELAYS) {
    if (!seen.has(url)) { seen.add(url); result.push(url) }
  }
  for (const url of discoveredRelays) {
    if (seen.has(url)) continue
    if (nip50Capable.has(url)) {
      seen.add(url); result.push(url)
    }
  }

  return result
}
