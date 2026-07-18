import { verifyEvent } from 'nostr-tools'
import { graph, computeEventVector } from '../graph'
import type { NodeType, PolyNode } from '../graph'
import { runPruneCache } from './pool'

// ── IDs ──

let insertOrderTieBreaker = 0
/**
 * Feed sort key: based on the event's own created_at (content time) rather
 * than wall-clock arrival time, so backfilled/older content sorts below
 * what's already in the feed instead of jumping to the top just because the
 * client fetched it just now. The tie-breaker only disambiguates events
 * sharing the same created_at second — once assigned it's cached on the
 * shape and never recomputed, so already-displayed items never reshuffle.
 */
function nextInsertOrder(createdAt: number): number {
  insertOrderTieBreaker = (insertOrderTieBreaker + 1) % 1000
  return createdAt * 1_000_000 + insertOrderTieBreaker
}

// ── Types (unchanged) ──

export interface CachedEvent {
  id: string
  kind: number
  pubkey: string
  created_at: number
  event: any
  eTags?: string[]
  pTags?: string[]
  /** Origin relay URL, when known. Populated from per-relay subscriptions
   *  (e.g. NIP-50 search). Used to build relay→event OBSERVED_ON edges. */
  relay?: string
}

export interface VideoShape {
  id: string;
  kind?: number;
  pubkey: string;
  created_at: number;
  firstSeen?: number;
  insertOrder?: number;
  videoUrl: string;
  thumbnailUrl?: string;
  title?: string;
  summary?: string;
  hashtags?: string[];
  mimeType?: string;
  duration?: number;
  width?: number;
  height?: number;
  size?: number;
  authorName?: string;
  authorPicture?: string;
  authorTrustScore?: number;
  replyCount?: number;
  reactionCount?: number;
  repostCount?: number;
  zapCount?: number;
  zapTotalSats?: number;
  relayCount?: number;
  relaysSeenOn?: string[];
  mediaStatus?: "unknown" | "available" | "failed" | "too_large" | "unsupported";
  isFailed?: boolean;
  contentWarning?: string;
  hidden?: boolean;
  hiddenAt?: number;
  userState?: {
    watched?: boolean;
    skipped?: boolean;
    liked?: boolean;
    boosted?: boolean;
    zapped?: boolean;
  };
  updatedAt: number;
}

export interface MediaStatusRecord {
  url: string;
  status: "unknown" | "available" | "failed" | "too_large" | "unsupported";
  size?: number;
  duration?: number;
  updatedAt: number;
}

export interface UserVideoStateRecord {
  id: string;
  watched?: boolean;
  skipped?: boolean;
  liked?: boolean;
  boosted?: boolean;
  zapped?: boolean;
  updatedAt: number;
}

export interface CreatorProfileRecord {
  pubkey: string
  name: string
  displayName?: string
  picture?: string
  nip05?: string
  isVerified?: boolean
  about?: string
  website?: string
  updatedAt: number
}

export interface VideoCountersRecord {
  id: string
  reactionCount: number
  repostCount: number
  replyCount: number
  zapCount: number
  zapTotalSats: number
}

export interface KindOneRejectionRecord {
  id: string
  reason: string
  checkedAt: number
}

// ── Graph-backed Table API ──

const NODE_TYPES: Record<string, NodeType> = {
  cachedEvents: 'event',
  videoShapes: 'video_shape',
  mediaStatus: 'media',
  userVideoState: 'user_state',
  authorProfiles: 'profile',
  videoCounters: 'counter',
  kindOneRejections: 'rejection',
}

const ID_PREFIXES: Record<string, string> = {
  cachedEvents: 'evt',
  videoShapes: 'shp',
  mediaStatus: 'med',
  userVideoState: 'sta',
  authorProfiles: 'pro',
  videoCounters: 'cnt',
  kindOneRejections: 'rej',
}

function prefixed(tableName: string, id: string): string {
  return `${ID_PREFIXES[tableName]}:${id}`
}

function unPrefixed(prefixedId: string): string {
  const colon = prefixedId.indexOf(':')
  return colon >= 0 ? prefixedId.slice(colon + 1) : prefixedId
}

/** Compute a NIP-01/NIP-33 replaceable key for the given event.
 *  Returns `${kind}:${pubkey}` for kinds 0 and 3,
 *  `${kind}:${pubkey}:${dTag}` for addressable events (NIP-33 range),
 *  or null when the event kind is not replaceable. */
function replaceableKeyFromEvent(event: any): string | null {
  const kind = event.kind as number
  if (kind === 0 || kind === 3) return `${kind}:${event.pubkey}`
  if ((kind >= 10000 && kind < 20000) || (kind >= 30000 && kind < 40000)) {
    const dTag = event.tags?.find((t: any) => t[0] === 'd')?.[1] ?? ''
    return `${kind}:${event.pubkey}:${dTag}`
  }
  return null
}

class Collection<T> {
  private results: PolyNode[]
  private type: NodeType

  constructor(results: PolyNode[], type: NodeType) {
    this.results = results
    this.type = type
  }

  toArray(): Promise<T[]> {
    return Promise.resolve(this.results.map(n => n.data as unknown as T))
  }

  first(): Promise<T | undefined> {
    return Promise.resolve(this.results[0]?.data as unknown as T | undefined)
  }

  count(): Promise<number> {
    return Promise.resolve(this.results.length)
  }

  primaryKeys(): Promise<string[]> {
    return Promise.resolve(this.results.map(n => n.id))
  }

  uniqueKeys(): Promise<string[]> {
    const keys = new Set<string>()
    for (const n of this.results) {
      const kind = (n.data as Record<string, unknown>).kind as number | undefined
      if (kind !== undefined) keys.add(String(kind))
    }
    return Promise.resolve([...keys])
  }

  filter(fn: (item: T) => boolean): Collection<T> {
    this.results = this.results.filter(n => fn(n.data as unknown as T))
    return this
  }

  limit(n: number): Collection<T> {
    this.results = this.results.slice(0, n)
    return this
  }

  reverse(): Collection<T> {
    this.results = [...this.results].reverse()
    return this
  }

  sort(compareFn: (a: T, b: T) => number): Collection<T> {
    this.results = [...this.results].sort((a, b) => compareFn(a.data as unknown as T, b.data as unknown as T))
    return this
  }

  modify(changes: Record<string, unknown> | ((item: T) => void)): Promise<void> {
    for (const node of this.results) {
      if (typeof changes === 'function') {
        changes(node.data as unknown as T)
      } else {
        Object.assign(node.data, changes)
      }
      node.updatedAt = Date.now()
    }
    return Promise.resolve()
  }

  delete(): Promise<void> {
    for (const node of this.results) {
      graph.removeNode(node.id)
    }
    return Promise.resolve()
  }
}

class WhereClause<T> {
  private tableName: string
  private type: NodeType
  private indexField: string

  constructor(tableName: string, type: NodeType, indexField: string) {
    this.tableName = tableName
    this.type = type
    this.indexField = indexField
  }

  equals(value: string): Collection<T> {
    const nodes = queryIndex(this.type, this.indexField, value)
    return new Collection<T>(nodes, this.type)
  }

  anyOf(values: (string | number)[]): Collection<T> {
    const valueSet = new Set(values)
    const results: PolyNode[] = []
    for (const node of graph.whereType(this.type)) {
      const fieldVal = (node.data as Record<string, unknown>)[this.indexField]
      if (fieldVal !== undefined && valueSet.has(fieldVal as string | number)) {
        results.push(node)
      }
    }
    return new Collection<T>(results, this.type)
  }

  above(value: number): Collection<T> {
    const results: PolyNode[] = []
    for (const node of graph.whereType(this.type)) {
      const fieldVal = (node.data as Record<string, unknown>)[this.indexField]
      if (typeof fieldVal === 'number' && fieldVal > value) results.push(node)
    }
    return new Collection<T>(results, this.type)
  }

  below(value: number): Collection<T> {
    const results: PolyNode[] = []
    for (const node of graph.whereType(this.type)) {
      const fieldVal = (node.data as Record<string, unknown>)[this.indexField]
      if (typeof fieldVal === 'number' && fieldVal < value) results.push(node)
    }
    return new Collection<T>(results, this.type)
  }
}

function queryIndex(type: NodeType, field: string, value: string): PolyNode[] {
  const results: PolyNode[] = []
  for (const node of graph.whereType(type)) {
    const fieldVal = (node.data as Record<string, unknown>)[field]
    if (Array.isArray(fieldVal) && fieldVal.includes(value)) {
      results.push(node)
    } else if (fieldVal === value) {
      results.push(node)
    }
  }
  return results
}

class Table<T> {
  private type: NodeType
  readonly name: string
  private prefix: string

  constructor(name: string) {
    this.name = name
    this.type = NODE_TYPES[name]
    this.prefix = ID_PREFIXES[name]
    if (!this.type) throw new Error(`Unknown table: ${name}`)
  }

  private pid(id: string): string {
    return `${this.prefix}:${id}`
  }

  get(id: string): Promise<T | undefined> {
    const node = graph.getNode(this.pid(id))
    if (!node || node.type !== this.type) return Promise.resolve(undefined)
    return Promise.resolve(node.data as unknown as T)
  }

  put(record: any): Promise<void> {
    const rawId = record.id || record.pubkey || record.url
    graph.addNode({
      id: this.pid(rawId),
      type: this.type,
      data: record as Record<string, unknown>,
      insertedAt: Date.now(),
      updatedAt: Date.now(),
    })
    return Promise.resolve()
  }

  bulkPut(records: any[]): Promise<void> {
    for (const record of records) this.put(record)
    return Promise.resolve()
  }

  bulkDelete(ids: string[]): Promise<void> {
    for (const id of ids) graph.removeNode(this.pid(id))
    return Promise.resolve()
  }

  delete(id: string): Promise<void> {
    graph.removeNode(this.pid(id))
    return Promise.resolve()
  }

  count(): Promise<number> {
    let count = 0
    for (const node of graph.whereType(this.type)) { count++ }
    return Promise.resolve(count)
  }

  where(index: Record<string, unknown>): Collection<T>
  where(index: string): WhereClause<T>
  where(index: string | Record<string, unknown>): WhereClause<T> | Collection<T> {
    if (typeof index === 'object') {
      const entries = Object.entries(index)
      // Fast path: when querying by kind, start from the kind index (which
      // holds every matching node) instead of scanning every node of this
      // table's type — cheap even when the type holds thousands of nodes.
      const kindEntry = entries.find(([k]) => k === 'kind')
      const base = typeof kindEntry?.[1] === 'number'
        ? graph.byKind(kindEntry[1], this.type)
        : graph.whereType(this.type)
      const nodes = base.filter(n => {
        return entries.every(([k, v]) => (n.data as Record<string, unknown>)[k] === v)
      })
      return new Collection<T>(nodes, this.type)
    }
    return new WhereClause<T>(this.name, this.type, index)
  }

  orderBy(field: string): Collection<T> {
    const nodes = graph.whereType(this.type)
      .sort((a, b) => {
        const av = (a.data as Record<string, unknown>)[field] as number ?? 0
        const bv = (b.data as Record<string, unknown>)[field] as number ?? 0
        return av - bv
      })
    return new Collection<T>(nodes, this.type)
  }

  filter(fn: (item: T) => boolean): Collection<T> {
    const nodes = graph.whereType(this.type)
      .filter(n => fn(n.data as unknown as T))
    return new Collection<T>(nodes, this.type)
  }

  toArray(): Promise<T[]> {
    const results: T[] = []
    for (const node of graph.whereType(this.type)) {
      results.push(node.data as unknown as T)
    }
    return Promise.resolve(results)
  }
}

// ── Database ──

class CacheDB {
  cachedEvents = new Table<CachedEvent>('cachedEvents')
  videoShapes = new Table<VideoShape>('videoShapes')
  mediaStatus = new Table<MediaStatusRecord>('mediaStatus')
  userVideoState = new Table<UserVideoStateRecord>('userVideoState')
  authorProfiles = new Table<CreatorProfileRecord>('authorProfiles')
  videoCounters = new Table<VideoCountersRecord>('videoCounters')
  kindOneRejections = new Table<KindOneRejectionRecord>('kindOneRejections')
}

export const db = new CacheDB()

// ── Helpers (unchanged logic, graph-backed) ──

export const MAX_VIDEOS = 10000
const MAX_EVENT_NODES = 30000
const PRUNE_INTERVAL = 30
let _saveCounter = 0

export async function pruneCache(): Promise<void> {
  const removedIds = await runPruneCache()
  if (removedIds.length === 0) return

  // Remove from in-memory graph to stay in sync with IDB
  graph.startBatch()
  try {
    for (const id of removedIds) {
      if (graph.getNode(id)) graph.removeNode(id)
    }
  } finally {
    graph.endBatch()
  }
}

export async function pruneBlockedContent(pubkeys: string[]): Promise<void> {
  if (pubkeys.length === 0) return
  const pkSet = new Set(pubkeys)

  const toRemove: string[] = []
  const urlsToRemove: string[] = []

  for (const node of graph.whereType('video_shape')) {
    const pubkey = (node.data as Record<string, unknown>).pubkey as string | undefined
    if (pubkey && pkSet.has(pubkey)) {
      toRemove.push(node.id)
      const videoUrl = (node.data as Record<string, unknown>).videoUrl as string | undefined
      if (videoUrl) urlsToRemove.push(videoUrl)
    }
  }
  for (const node of graph.whereType('event')) {
    const pubkey = (node.data as Record<string, unknown>).pubkey as string | undefined
    if (pubkey && pkSet.has(pubkey)) {
      toRemove.push(node.id)
    }
  }

  for (const id of toRemove) graph.removeNode(id)
  for (const url of urlsToRemove) {
    const node = graph.getNode(url)
    if (node?.type === 'media') graph.removeNode(url)
  }
}

const VIDEO_EXT_RE = /\.(mp4|webm|ogg|mov|avi|mkv|m3u8|ts|m4v)($|\?)/i

export function extractVideoUrlFromContent(content: string): string | null {
  const urlRe = /https?:\/\/[^\s<>"']+/g
  const urls = content.match(urlRe)
  if (!urls) return null
  for (const url of urls) {
    if (VIDEO_EXT_RE.test(url)) return url
  }
  return null
}

function parseImetaTag(imetaTag: string[]): Record<string, string> {
  const data: Record<string, string> = {}
  for (let i = 1; i < imetaTag.length; i++) {
    const entry = imetaTag[i]
    const spaceIndex = entry.indexOf(' ')
    if (spaceIndex !== -1) {
      const key = entry.slice(0, spaceIndex)
      const val = entry.slice(spaceIndex + 1)
      data[key] = val
    }
  }
  return data
}

/**
 * Ensure a MEDIA node exists in the graph for the given URL.
 * Returns the URL (used as the node ID for media nodes).
 */
function ensureMediaNode(url: string): void {
  const existing = graph.getNode(`med:${url}`)
  if (existing) return
  graph.addNode({
    id: `med:${url}`,
    type: 'media',
    data: { url, canonicalShapeId: null, sharerCount: 0 },
    insertedAt: Date.now(),
    updatedAt: Date.now(),
  })
}

/** Ensure a HASHTAG node exists in the graph for the given tag. */
function ensureHashtagNode(tag: string): void {
  const id = `has:${tag.toLowerCase()}`
  const existing = graph.getNode(id)
  if (existing) return
  graph.addNode({
    id,
    type: 'hashtag',
    data: { tag, normalized: tag.toLowerCase() },
    insertedAt: Date.now(),
    updatedAt: Date.now(),
  })
}

/** Ensure a RELAY node exists in the graph for the given relay URL. */
function ensureRelayNode(url: string): void {
  const id = `rly:${normalizeRelayUrl(url)}`
  const existing = graph.getNode(id)
  if (existing) return
  graph.addNode({
    id,
    type: 'relay',
    data: { url, normalized: normalizeRelayUrl(url) },
    insertedAt: Date.now(),
    updatedAt: Date.now(),
  })
}

function normalizeRelayUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * Record that an event was observed on a particular relay by adding an
 * OBSERVED_ON edge. Lazily-creates the relay node if needed.
 */
function recordRelayObservation(eventId: string, relayUrl: string): void {
  const normalized = normalizeRelayUrl(relayUrl)
  ensureRelayNode(normalized)
  // Edge source uses the raw event id (matching the existing convention in
  // recordMediaEdge where graph.addEdge(eventId, 'HAS_MEDIA', url) uses
  // the raw id, not the evt:-prefixed node id).
  graph.addEdge(eventId, 'OBSERVED_ON', `rly:${normalized}`)
}

/**
 * Materialize graph edges from Nostr tags on an event.
 * Called after the event has been stored as a cachedEvent node.
 */
function materializeEventEdges(event: any, eventId: string): void {
  if (!event.tags) return

  const prefixedId = `evt:${eventId}`

  for (const tag of event.tags) {
    if (tag[0] === 'e' && tag[1]) {
      // e-tags: REFERENCES edges with optional marker from NIP-10.
      const data: Record<string, unknown> = {}
      if (tag[3]) data.marker = tag[3]
      graph.addEdge(prefixedId, 'REFERENCES', `evt:${tag[1]}`, data)
    } else if (tag[0] === 'p' && tag[1]) {
      // p-tags: MENTIONS edges (pubkey → person referenced).
      if (tag[1] !== event.pubkey) {
        graph.addEdge(prefixedId, 'MENTIONS', tag[1])
      }
    } else if (tag[0] === 't' && tag[1]) {
      // t-tags: TAGGED_WITH edges.
      ensureHashtagNode(tag[1])
      graph.addEdge(prefixedId, 'TAGGED_WITH', `has:${tag[1].toLowerCase()}`)
    } else if (tag[0] === 'a' && tag[1]) {
      // a-tags: REFERENCES with address marker.
      graph.addEdge(prefixedId, 'REFERENCES', tag[1], { marker: 'address' })
    }
  }
}

/**
 * Record that an event references a video URL by adding a HAS_MEDIA edge.
 * If this URL already has a canonical shape, returns that shape's ID
 * (so the caller can dedup). If it's the first event for this URL,
 * sets this event as the canonical shape and returns null.
 */
async function recordMediaEdge(url: string, eventId: string, pubkey: string): Promise<string | null> {
  ensureMediaNode(url)
  const mediaNodeId = `med:${url}`
  const mediaNode = graph.getNode(mediaNodeId)!
  const data = mediaNode.data as Record<string, unknown>

  // Add HAS_MEDIA edge: event → media
  graph.addEdge(eventId, 'HAS_MEDIA', url, undefined, 'shared')
  // Add AUTHORED_BY edge: event → pubkey (if not already present)
  graph.addEdge(eventId, 'AUTHORED_BY', pubkey)

  // Check if there's already a canonical shape for this URL
  const canonicalId = data.canonicalShapeId as string | null

  if (canonicalId && canonicalId !== eventId) {
    const prevCount = (data.sharerCount as number) ?? 1
    graph.updateNode(mediaNodeId, { sharerCount: prevCount + 1, updatedAt: Date.now() })
    return canonicalId
  }

  // First event for this URL — make this the canonical shape
  graph.updateNode(mediaNodeId, { canonicalShapeId: eventId, sharerCount: 1, updatedAt: Date.now() })
  return null
}

/**
 * Query: given a video URL, return all pubkeys whose events reference it.
 */
export function getSharers(url: string): string[] {
  const eventIds = graph.getEdgeSources(url, 'HAS_MEDIA')
  const pubkeys = new Set<string>()
  for (const eid of eventIds) {
    const targets = graph.getEdgeTargets(eid, 'AUTHORED_BY')
    for (const pk of targets) pubkeys.add(pk)
  }
  return [...pubkeys]
}

/**
 * Query: given a pubkey, return all video URLs they've shared (via their events).
 */
export function getSharedUrls(pubkey: string): string[] {
  const urls = new Set<string>()
  for (const node of graph.byPubkey(pubkey)) {
    if (node.type !== 'event') continue
    const data = node.data as Record<string, unknown>
    if (data.videoUrl) {
      urls.add(data.videoUrl as string)
    }
  }
  return [...urls]
}

export async function buildOrUpdateVideoShape(event: any): Promise<VideoShape | null> {
  const isVideo = event.kind === 1 || event.kind === 21 || event.kind === 22 || event.kind === 34236
  if (!isVideo) return null

  try {
    const existing = (await db.videoShapes.get(event.id)) as VideoShape | undefined

    if (event.kind === 1) {
      const videoUrl = extractVideoUrlFromContent(event.content || '')
      if (!videoUrl) return null

      // Polygraph: record the event→URL edge. If this URL already has a
      // canonical shape, dedup by returning the existing shape.
      const canonicalId = await recordMediaEdge(videoUrl, event.id, event.pubkey)
      if (canonicalId) {
        // Increment relay count on the canonical shape
        const canonical = await db.videoShapes.get(canonicalId) as VideoShape | undefined
        if (canonical) {
          await db.videoShapes.put({
            ...canonical,
            relayCount: (canonical.relayCount ?? 0) + 1,
            updatedAt: Date.now(),
          })
        }
        return null
      }

      const hashtags = event.tags.filter((t: any) => t[0] === 't').map((t: any) => t[1])
      const cachedUserState = existing ? await db.userVideoState.get(event.id) : undefined
      const userState = cachedUserState ? {
        watched: cachedUserState.watched,
        skipped: cachedUserState.skipped,
        liked: cachedUserState.liked,
        boosted: cachedUserState.boosted,
        zapped: cachedUserState.zapped
      } : existing?.userState

      const shape: VideoShape = {
        id: event.id, kind: event.kind, pubkey: event.pubkey, created_at: event.created_at,
        firstSeen: existing?.firstSeen ?? Date.now(),
        insertOrder: existing?.insertOrder ?? nextInsertOrder(event.created_at),
        videoUrl, thumbnailUrl: existing?.thumbnailUrl,
        title: existing?.title ?? '', summary: event.content || (existing?.summary ?? ''),
        hashtags: hashtags.length > 0 ? hashtags : (existing?.hashtags ?? []),
        mimeType: existing?.mimeType, size: existing?.size, duration: existing?.duration,
        mediaStatus: existing?.mediaStatus ?? 'unknown', isFailed: existing?.mediaStatus === 'failed',
        contentWarning: existing?.contentWarning, userState,
        reactionCount: existing?.reactionCount ?? 0, repostCount: existing?.repostCount ?? 0,
        replyCount: existing?.replyCount ?? 0, zapCount: existing?.zapCount ?? 0,
        zapTotalSats: existing?.zapTotalSats ?? 0, updatedAt: Date.now()
      }

      await db.videoShapes.put(shape)
      return shape
    }

    const titleTag = event.tags.find((t: any) => t[0] === 'title')
    const title = titleTag ? titleTag[1] : (existing?.title ?? '')
    const altTag = event.tags.find((t: any) => t[0] === 'alt')
    const summary = event.content || (altTag ? altTag[1] : (existing?.summary ?? ''))
    const hashtags = event.tags.filter((t: any) => t[0] === 't').map((t: any) => t[1])
    const finalHashtags = hashtags.length > 0 ? hashtags : (existing?.hashtags ?? [])
    const cwTag = event.tags.find((t: any) => t[0] === 'content-warning')
    const nsfwLabel = event.tags.find((t: any) => t[0] === 'l' && t[1] === 'nsfw')
    const hasNsfwContent = /\b(NSFW|porn|PORN)\b/i.test(event.content || '')
    const contentWarning = cwTag?.[1] || nsfwLabel?.[1] || (hasNsfwContent ? 'NSFW' : undefined) || existing?.contentWarning

    const imetaTag = event.tags.find((t: any) => t[0] === 'imeta')
    let videoUrl = existing?.videoUrl ?? ''
    let thumbnailUrl = existing?.thumbnailUrl
    let mimeType = existing?.mimeType
    let size = existing?.size

    if (imetaTag) {
      const imetaData = parseImetaTag(imetaTag)
      if (imetaData['url']) videoUrl = imetaData['url']
      if (imetaData['image']) thumbnailUrl = imetaData['image']
      if (imetaData['m']) mimeType = imetaData['m']
      if (imetaData['size']) size = parseInt(imetaData['size'], 10)
    }

    if (!videoUrl) {
      const urlTag = event.tags.find((t: any) => t[0] === 'url')
      if (urlTag) videoUrl = urlTag[1]
    }
    if (!videoUrl) {
      const urlMatch = event.content?.match(/(https?:\/\/[^\s]+)\.(mp4|webm|mov)/i)
      if (urlMatch) videoUrl = urlMatch[0]
    }
    if (!videoUrl) return null

    // Polygraph: record the event→URL edge. If this URL already has a
    // canonical shape, dedup by returning the existing shape.
    const canonicalId = await recordMediaEdge(videoUrl, event.id, event.pubkey)
    if (canonicalId) {
      const canonical = await db.videoShapes.get(canonicalId) as VideoShape | undefined
      if (canonical) {
        await db.videoShapes.put({
          ...canonical,
          relayCount: (canonical.relayCount ?? 0) + 1,
          updatedAt: Date.now(),
        })
      }
      return null
    }

    const cachedMedia = (existing?.videoUrl === videoUrl && existing?.mediaStatus !== 'unknown')
      ? null
      : await db.mediaStatus.get(videoUrl)
    const mediaStatus = cachedMedia?.status ?? existing?.mediaStatus ?? 'unknown'
    const isFailed = mediaStatus === 'failed'
    const duration = cachedMedia?.duration ?? existing?.duration

    const cachedUserState = existing ? await db.userVideoState.get(event.id) : undefined
    const userState = cachedUserState ? {
      watched: cachedUserState.watched, skipped: cachedUserState.skipped,
      liked: cachedUserState.liked, boosted: cachedUserState.boosted,
      zapped: cachedUserState.zapped
    } : existing?.userState

    const shape: VideoShape = {
      id: event.id, kind: event.kind, pubkey: event.pubkey, created_at: event.created_at,
      firstSeen: existing?.firstSeen ?? Date.now(),
      insertOrder: existing?.insertOrder ?? nextInsertOrder(event.created_at),
      videoUrl, thumbnailUrl, title, summary, hashtags: finalHashtags,
      mimeType, size, duration, mediaStatus, isFailed, contentWarning, userState,
      reactionCount: existing?.reactionCount ?? 0, repostCount: existing?.repostCount ?? 0,
      replyCount: existing?.replyCount ?? 0, zapCount: existing?.zapCount ?? 0,
      zapTotalSats: existing?.zapTotalSats ?? 0, updatedAt: Date.now()
    }

    await db.videoShapes.put(shape)
    return shape
  } catch (err) {
    console.error('[Cache] Failed to build video shape:', err)
    return null
  }
}

export async function updateMediaStatus(url: string, status: MediaStatusRecord['status'], extra?: { size?: number; duration?: number }): Promise<void> {
  await db.mediaStatus.put({
    url, status, size: extra?.size, duration: extra?.duration, updatedAt: Date.now()
  })

  if (status === 'failed') {
    for (const node of graph.whereType('video_shape')) {
      const data = node.data as Record<string, unknown>
      if (data.videoUrl === url) {
        graph.updateNode(node.id, {
          mediaStatus: status,
          isFailed: true,
          ...(extra?.size !== undefined ? { size: extra.size } : {}),
          ...(extra?.duration !== undefined ? { duration: extra.duration } : {}),
        })
      }
    }
  }
}

export async function updateUserVideoState(id: string, state: Partial<Omit<UserVideoStateRecord, 'id' | 'updatedAt'>>): Promise<void> {
  const existing = await db.userVideoState.get(id)
  const updatedRec: UserVideoStateRecord = {
    id,
    watched: state.watched ?? existing?.watched,
    skipped: state.skipped ?? existing?.skipped,
    liked: state.liked ?? existing?.liked,
    boosted: state.boosted ?? existing?.boosted,
    zapped: state.zapped ?? existing?.zapped,
    updatedAt: Date.now()
  }
  await db.userVideoState.put(updatedRec)
  graph.addEdge(`shp:${id}`, 'HAS_STATE', `sta:${id}`, undefined, 'owned')

  const shape = await db.videoShapes.get(id)
  if (shape) {
    await db.videoShapes.put({
      ...(shape as any),
      userState: {
        watched: updatedRec.watched,
        skipped: updatedRec.skipped,
        liked: updatedRec.liked,
        boosted: updatedRec.boosted,
        zapped: updatedRec.zapped
      },
      updatedAt: Date.now()
    })
  }
}

/**
 * Batched "seen" write for feed resume tracking and feed-window paging.
 * Embeds `watched` on the shape itself (in addition to userVideoState) so
 * useFeedVideos can query "not yet watched" directly instead of a ranked
 * top-N snapshot that can silently evict whatever the user is currently
 * viewing when a large batch of new content arrives — watched status is the
 * feed's cue for what to page in next as the user scrolls through it.
 *
 * This does mean marking videos seen now touches video_shape nodes (which
 * useGraphQuery subscribers, including the feed query, react to) — but
 * callers accumulate ids client-side and flush this periodically rather
 * than per-video, and the resulting change events are wrapped in a single
 * startBatch/endBatch and land within the feed query's own debounce window,
 * so this doesn't turn into a per-scroll-tick requery storm.
 */
export async function markVideosSeen(ids: Iterable<string>): Promise<void> {
  const idList = [...new Set(ids)]
  if (idList.length === 0) return
  graph.startBatch()
  try {
    for (const id of idList) {
      const existing = await db.userVideoState.get(id)
      if (existing?.watched) continue
      await db.userVideoState.put({
        id,
        watched: true,
        skipped: existing?.skipped,
        liked: existing?.liked,
        boosted: existing?.boosted,
        zapped: existing?.zapped,
        updatedAt: Date.now(),
      })
      const shape = await db.videoShapes.get(id)
      if (shape) {
        await db.videoShapes.put({
          ...(shape as any),
          userState: { ...(shape as any).userState, watched: true },
          updatedAt: Date.now(),
        })
      }
    }
  } finally {
    graph.endBatch()
  }
}

/** Which of the given video ids have been marked seen. Used to resume the
 *  feed near where the user left off when the exact last-position id is no
 *  longer in the loaded window (pruned, or feed content changed). */
export async function getSeenVideoIds(ids: string[]): Promise<Set<string>> {
  const seen = new Set<string>()
  for (const id of ids) {
    const rec = await db.userVideoState.get(id)
    if (rec?.watched) seen.add(id)
  }
  return seen
}

export async function buildOrUpdateAuthorProfile(event: any): Promise<CreatorProfileRecord | null> {
  if (event.kind !== 0) return null
  try {
    const data = JSON.parse(event.content)
    const name = data.name || data.display_name || event.pubkey.slice(0, 8)
    const picture = data.picture || data.image
    const profile: CreatorProfileRecord = {
      pubkey: event.pubkey, name,
      displayName: data.display_name || name, picture,
      nip05: data.nip05, isVerified: false,
      about: data.about, website: data.website, updatedAt: Date.now()
    }

    const existingProfile = await db.authorProfiles.get(event.pubkey)
    if (existingProfile && existingProfile.name === name && existingProfile.picture === picture) {
      return existingProfile
    }

    await db.authorProfiles.put(profile)

    for (const node of graph.byPubkey(event.pubkey, 'video_shape')) {
      graph.updateNode(node.id, { authorName: name, authorPicture: picture })
    }
    return profile
  } catch (err) {
    console.error('[Cache] Failed to project profile event:', err)
    return null
  }
}

const BULK_INSERT_CHUNK = 50

const YIELD_INTERVAL = 20

function yieldToUI(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

export async function bulkSaveEventsToCache(events: any[], relay?: string): Promise<void> {
  if (events.length === 0) return

  graph.startBatch()
  try {
    const videoShapes: VideoShape[] = []
    const reactionEvents: Array<{ eTag: string; event: any }> = []
    const profileEvents: any[] = []

    for (let i = 0; i < events.length; i++) {
      const event = events[i]

      if (i > 0 && i % YIELD_INTERVAL === 0) {
        await yieldToUI()
      }
    if (!event || !event.id || typeof event.kind !== 'number') continue
    if (!event.sig) continue
    if (event.sig !== 'local-preview-sig' && !event.sig.startsWith('mock-')) {
      try {
        if (!verifyEvent(event as any)) continue
      } catch {
        continue
      }
    }

    const { id, kind, pubkey, created_at } = event
    const isVideo = kind === 1 || kind === 21 || kind === 22 || kind === 34236
    const isReaction = kind === 7 || kind === 16 || kind === 9735 || kind === 1111

    // Kind-1 notes are only worth caching if they actually link a video —
    // otherwise the firehose feed subscription (kinds: [1,21,22,34236],
    // no content filter) would fill cachedEvents with ordinary text notes.
    // Mirrors the check in saveEventToCache.
    if (kind === 1) {
      const rejected = await db.kindOneRejections.get(id)
      if (rejected) continue
      const videoUrl = extractVideoUrlFromContent(event.content || '')
      if (!videoUrl) {
        await db.kindOneRejections.put({ id, reason: 'no_video_url', checkedAt: Date.now() })
        continue
      }
    }

    const eTags = (event.tags || []).filter((t: any) => t[0] === 'e').map((t: any) => t[1])
    const pTags = (event.tags || []).filter((t: any) => t[0] === 'p').map((t: any) => t[1])

    const existing = await db.cachedEvents.get(id)
    if (existing) continue

    const cachedEvent: CachedEvent = { id, kind, pubkey, created_at, event, eTags, pTags, relay }

    // Use putReplaceable for NIP-01/NIP-33 replaceable events.
    const rKey = replaceableKeyFromEvent(event)
    if (rKey) {
      const inserted = await graph.putReplaceable({
        id: prefixed('cachedEvents', id),
        type: 'event',
        data: { ...cachedEvent as any, replaceableKey: rKey },
        vector: undefined,
        insertedAt: Date.now(),
        updatedAt: Date.now(),
      })
      if (!inserted) continue // newer version already exists
    } else {
      await db.cachedEvents.put(cachedEvent)
    }

    // Kind 5 (deletion): hide target shapes, zero counters, then skip
    // materialization / vector / shaping.
    if (kind === 5) {
      const targetIds = eTags
      for (const targetId of targetIds) {
        const shapeNode = graph.getNode(`shp:${targetId}`)
        if (!shapeNode) continue
        // NIP-09: only the original author may delete their event.
        const shapePubkey = (shapeNode.data as Record<string, unknown>).pubkey as string | undefined
        if (shapePubkey && shapePubkey !== pubkey) continue
        graph.updateNode(shapeNode.id, { hidden: true, hiddenAt: Date.now() })
        const counterNode = graph.getNode(`cnt:${targetId}`)
        if (counterNode) {
          graph.updateNode(counterNode.id, {
            reactionCount: 0, repostCount: 0, replyCount: 0,
            zapCount: 0, zapTotalSats: 0,
          })
        }
      }
      continue
    }

    // Materialize graph edges from Nostr tags (e, p, t, a).
    materializeEventEdges(event, id)

    if (isVideo) {
      const shape = await buildOrUpdateVideoShape(event)
      if (shape) videoShapes.push(shape)
    } else if (isReaction) {
      for (const eId of eTags) {
        reactionEvents.push({ eTag: eId, event })
      }
    } else if (kind === 0) {
      profileEvents.push(event)
    }
  }

  // Bulk-apply reaction counts
  if (reactionEvents.length > 0) {
    const counterMap = new Map<string, VideoCountersRecord>()
    for (const { eTag, event } of reactionEvents) {
      let entry = counterMap.get(eTag)
      if (!entry) {
        const existing = await db.videoCounters.get(eTag)
        entry = existing ?? { id: eTag, reactionCount: 0, repostCount: 0, replyCount: 0, zapCount: 0, zapTotalSats: 0 }
        counterMap.set(eTag, entry)
      }
      const kind = event.kind
      if (kind === 7) entry.reactionCount += 1
      else if (kind === 6 || kind === 16) entry.repostCount += 1
      else if (kind === 1111) entry.replyCount += 1
      else if (kind === 9735) {
        entry.zapCount += 1
        const descriptionTag = event.tags.find((t: any) => t[0] === 'description')?.[1]
        if (descriptionTag) {
          try {
            const parsedDesc = JSON.parse(descriptionTag)
            const amount = parsedDesc.tags.find((t: any) => t[0] === 'amount')?.[1]
            if (amount) {
              entry.zapTotalSats += Math.floor(parseInt(amount, 10) / 1000)
            }
          } catch (_) {}
        }
      }
    }
    const counterRecords = Array.from(counterMap.values())
    for (const c of counterRecords) await db.videoCounters.put(c)
  }

  if (profileEvents.length > 0) {
    for (const ev of profileEvents) {
      await buildOrUpdateAuthorProfile(ev).catch(() => {})
    }
  }

  if (++_saveCounter % PRUNE_INTERVAL === 0) {
    void pruneCache()
  }
  } finally {
    graph.endBatch()
  }
}

export async function saveEventToCache(event: any, trusted = false, relay?: string): Promise<void> {
  if (!event || !event.id || typeof event.kind !== 'number') return

  if (!trusted) {
    if (!event.sig) {
      console.warn(`[Cache] Rejected event ${event.id} — missing signature`)
      return
    }
    if (event.sig !== 'local-preview-sig' && !event.sig.startsWith('mock-')) {
      try {
        if (!verifyEvent(event as any)) {
          console.warn(`[Cache] Rejected event ${event.id} — invalid signature`)
          return
        }
      } catch {
        console.warn(`[Cache] Signature verification error for event ${event.id}`)
        return
      }
    }
  }

  const { id, kind, pubkey, created_at } = event
  const isVideo = kind === 1 || kind === 21 || kind === 22 || kind === 34236
  const isReactionOrComment = kind === 7 || kind === 16 || kind === 9735 || kind === 1111

  let wroteCachedEvent = false
  const cleanup = async () => {
    if (wroteCachedEvent) {
      graph.removeNode(prefixed('cachedEvents', id))
    }
  }

  graph.startBatch()
  try {
    if (kind === 1) {
      const rejected = await db.kindOneRejections.get(id)
      if (rejected) return
      const videoUrl = extractVideoUrlFromContent(event.content || '')
      if (!videoUrl) {
        await db.kindOneRejections.put({ id, reason: 'no_video_url', checkedAt: Date.now() })
        return
      }
    }

    const eTags = (event.tags || []).filter((t: any) => t[0] === 'e').map((t: any) => t[1])
    const pTags = (event.tags || []).filter((t: any) => t[0] === 'p').map((t: any) => t[1])
    const cachedEvent: CachedEvent = { id, kind, pubkey, created_at, event, eTags, pTags, relay }

    // ── Kind 5: Deletion / event deletion ─────────────────────
    if (kind === 5) {
      const targetIds = eTags
      for (const targetId of targetIds) {
        const shapeNode = graph.getNode(`shp:${targetId}`)
        if (!shapeNode) continue
        // NIP-09: only the original author may delete their event.
        const shapePubkey = (shapeNode.data as Record<string, unknown>).pubkey as string | undefined
        if (shapePubkey && shapePubkey !== pubkey) continue
        graph.updateNode(shapeNode.id, { hidden: true, hiddenAt: Date.now() })
        const counterNode = graph.getNode(`cnt:${targetId}`)
        if (counterNode) {
          graph.updateNode(counterNode.id, { reactionCount: 0, repostCount: 0, replyCount: 0, zapCount: 0, zapTotalSats: 0 })
        }
      }
      // Store the kind-5 event as a tombstone but skip video/reaction shaping.
      await db.cachedEvents.put(cachedEvent)
      wroteCachedEvent = true
      return
    }

    const alreadyCached = await db.cachedEvents.get(id)
    if (alreadyCached) return

    // Use putReplaceable for NIP-01/NIP-33 replaceable events.
    const rKey = replaceableKeyFromEvent(event)
    if (rKey) {
      const inserted = await graph.putReplaceable({
        id: prefixed('cachedEvents', id),
        type: 'event',
        data: { ...cachedEvent as any, replaceableKey: rKey },
        vector: undefined,
        insertedAt: Date.now(),
        updatedAt: Date.now(),
      })
      if (!inserted) {
        // A newer version of this replaceable event already exists — skip.
        return
      }
    } else {
      await db.cachedEvents.put(cachedEvent)
    }
    wroteCachedEvent = true

    // Materialize graph edges from Nostr tags (e, p, t, a).
    materializeEventEdges(event, id)

    // Record relay observation if the origin relay is known.
    if (relay) recordRelayObservation(id, relay)

    const vec = computeEventVector({
      kind, pubkey, created_at,
      eTagsCount: eTags.length,
      pTagsCount: pTags.length,
      hashtags: event.tags?.filter((t: any) => t[0] === 't').map((t: any) => t[1]) ?? [],
    })
    graph.vectors.add(id, vec)
    graph.markVectorDirty(id)

    if (isVideo) {
      await buildOrUpdateVideoShape(event)
    }

    if (++_saveCounter % PRUNE_INTERVAL === 0) {
      void pruneCache()
    }

    if (isReactionOrComment) {
      for (const eId of eTags) {
        await incrementVideoCounts(eId, event)
      }
    } else if (kind === 0) {
      await buildOrUpdateAuthorProfile(event)
    }
  } catch (error) {
    console.error(`[Cache] Error saving event ${id} (kind=${kind}, pubkey=${pubkey.slice(0,8)}):`, error)
    await cleanup()
  } finally {
    graph.endBatch()
  }
}

async function incrementVideoCounts(videoId: string, reactionEvent: any): Promise<void> {
  const kind = reactionEvent.kind
  const existing = await db.videoCounters.get(videoId) ?? { id: videoId, reactionCount: 0, repostCount: 0, replyCount: 0, zapCount: 0, zapTotalSats: 0 }

  if (kind === 7) existing.reactionCount += 1
  else if (kind === 6 || kind === 16) existing.repostCount += 1
  else if (kind === 1111) existing.replyCount += 1
  else if (kind === 9735) {
    existing.zapCount += 1
    const descriptionTag = reactionEvent.tags.find((t: any) => t[0] === 'description')?.[1]
    if (descriptionTag) {
      try {
        const parsedDesc = JSON.parse(descriptionTag)
        const amount = parsedDesc.tags.find((t: any) => t[0] === 'amount')?.[1]
        if (amount) existing.zapTotalSats += Math.floor(parseInt(amount, 10) / 1000)
      } catch (_) {}
    }
  }

  await db.videoCounters.put(existing)
  graph.addEdge(`shp:${videoId}`, 'HAS_COUNTER', `cnt:${videoId}`, undefined, 'owned')
}

export async function mergeCountersIntoShape(shape: VideoShape): Promise<VideoShape> {
  const counters = await db.videoCounters.get(shape.id)
  if (!counters) return shape
  return {
    ...shape,
    reactionCount: counters.reactionCount,
    repostCount: counters.repostCount,
    replyCount: counters.replyCount,
    zapCount: counters.zapCount,
    zapTotalSats: counters.zapTotalSats,
  }
}

export async function mergeCountersIntoShapes(shapes: VideoShape[]): Promise<VideoShape[]> {
  if (shapes.length === 0) return shapes
  // Batch: query all counters in a single whereType scan instead of N individual lookups.
  const shapeIdSet = new Set(shapes.map(s => s.id))
  const counterNodes = graph.whereType('counter')
  const counterMap = new Map<string, VideoCountersRecord>()
  for (const node of counterNodes) {
    const c = node.data as unknown as VideoCountersRecord
    if (shapeIdSet.has(c.id)) {
      counterMap.set(c.id, c)
    }
  }
  return shapes.map((shape) => {
    const c = counterMap.get(shape.id)
    if (!c) return shape
    return {
      ...shape,
      reactionCount: c.reactionCount,
      repostCount: c.repostCount,
      replyCount: c.replyCount,
      zapCount: c.zapCount,
      zapTotalSats: c.zapTotalSats,
    }
  })
}

export async function getCacheVideoCount(): Promise<number> {
  return db.cachedEvents.where('kind').anyOf([1, 21, 22, 34236]).count()
}

export async function getCacheOldestVideoTimestamp(): Promise<number | null> {
  const shapes = await db.videoShapes.orderBy('created_at').toArray()
  return shapes[0]?.created_at ?? null
}
