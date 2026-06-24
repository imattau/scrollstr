import Dexie, { type Table } from 'dexie'

export const MAX_VIDEOS = 2000

let insertOrderCounter = 0
function nextInsertOrder(): number {
  return Date.now() * 1000 + (++insertOrderCounter % 1000)
}

export interface CachedEvent {
  id: string
  kind: number
  pubkey: string
  created_at: number
  last_accessed_at?: number
  event: any // The full signed Nostr event JSON
}

export interface VideoShape {
  id: string;
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
  contentWarning?: string;

  userState?: {
    watched?: boolean;
    skipped?: boolean;
    liked?: boolean;
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
  id: string; // matches video id
  watched?: boolean;
  skipped?: boolean;
  liked?: boolean;
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

export interface SocialRelationRecord {
  id?: number // Auto-incremented primary key
  pubkey: string // owner of the relation list (e.g. logged in user or creator)
  targetPubkey: string // target creator
  relationType: 'following' | 'follower'
  updatedAt: number
}

class ScrollstrCacheDatabase extends Dexie {
  cachedEvents!: Table<CachedEvent, string>
  videoShapes!: Table<VideoShape, string>
  mediaStatus!: Table<MediaStatusRecord, string>
  userVideoState!: Table<UserVideoStateRecord, string>
  authorProfiles!: Table<CreatorProfileRecord, string>
  socialRelations!: Table<SocialRelationRecord, number>

  constructor() {
    super('scrollstr-event-cache')
    this.version(6).stores({
      cachedEvents: 'id, [kind+pubkey], kind, pubkey, created_at',
      videoShapes: 'id, pubkey, created_at, videoUrl, insertOrder',
      mediaStatus: 'url, status',
      userVideoState: 'id',
      authorProfiles: 'pubkey',
      socialRelations: '++id, [pubkey+relationType], targetPubkey'
    })
  }
}

export const db = new ScrollstrCacheDatabase()

// Cache limits
const MAX_REACTIONS_COMMENTS = 20000
const MAX_PROFILES = 5000
const TOUCH_DEBOUNCE_MS = 250

let touchFlushTimer: ReturnType<typeof setTimeout> | null = null
const pendingTouchIds = new Set<string>()

/**
 * Loads all cached events from IndexedDB and adds them to the Applesauce EventStore.
 */
export async function loadCachedEvents(eventStore: any): Promise<void> {
  try {
    console.log('[Cache] Loading events from IndexedDB cache...')
    const startTime = performance.now()
    const allRecords = await db.cachedEvents.toArray()
    
    if (allRecords.length === 0) {
      console.log('[Cache] IndexedDB cache is empty.')
      return
    }

    // Add events to applesauce eventStore
    let count = 0
    const loadedIds: string[] = []
    allRecords.forEach((record) => {
      try {
        eventStore.add(record.event)
        count++
        loadedIds.push(record.id)
      } catch (err) {
        // Skip invalid events
      }
    })

    queueCachedEventTouches(loadedIds)

    const duration = (performance.now() - startTime).toFixed(1)
    console.log(`[Cache] Successfully loaded ${count} events from IndexedDB in ${duration}ms.`)
    
    // Asynchronously project loaded video events to VideoShape
    for (const record of allRecords) {
      const isVideo = record.kind === 21 || record.kind === 22 || record.kind === 34236
      if (isVideo) {
        void buildOrUpdateVideoShape(record.event)
      }
    }
  } catch (error) {
    console.error('[Cache] Error loading cached events:', error)
  }
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

export async function buildOrUpdateVideoShape(event: any): Promise<VideoShape | null> {
  try {
    const isVideo = event.kind === 21 || event.kind === 22 || event.kind === 34236
    if (!isVideo) return null

    const existing = await db.videoShapes.get(event.id)
    
    const titleTag = event.tags.find((t: any) => t[0] === 'title')
    const title = titleTag ? titleTag[1] : (existing?.title ?? '')

    const altTag = event.tags.find((t: any) => t[0] === 'alt')
    const summary = event.content || (altTag ? altTag[1] : (existing?.summary ?? ''))

    const hashtags = event.tags.filter((t: any) => t[0] === 't').map((t: any) => t[1])
    const finalHashtags = hashtags.length > 0 ? hashtags : (existing?.hashtags ?? [])

    // Parse content warning: check for content-warning tag or NIP-32 nsfw labels
    const cwTag = event.tags.find((t: any) => t[0] === 'content-warning')
    const nsfwLabel = event.tags.find((t: any) => t[0] === 'l' && t[1] === 'nsfw')
    const contentWarning = cwTag?.[1] || nsfwLabel?.[1] || existing?.contentWarning

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

    if (!videoUrl) return null

    // Check media status cache
    const cachedMedia = await db.mediaStatus.get(videoUrl)
    const mediaStatus = cachedMedia?.status ?? existing?.mediaStatus ?? 'unknown'
    const duration = cachedMedia?.duration ?? existing?.duration

    // Check local user behavior state
    const cachedUserState = await db.userVideoState.get(event.id)
    const userState = cachedUserState ? {
      watched: cachedUserState.watched,
      skipped: cachedUserState.skipped,
      liked: cachedUserState.liked,
      zapped: cachedUserState.zapped
    } : existing?.userState

    // Count reactions, zaps, comments from cachedEvents
    const associatedEvents = await db.cachedEvents.where('id').anyOf(event.id).toArray() // or scan via e-tag if queried
    // To keep it light, let's query kind-based counts for this videoId from cachedEvents
    // reaction kind: 7, 16, 6
    // reply kind: 1111
    // zap kind: 9735
    const reactions = await db.cachedEvents.filter(rec => {
      const isReaction = rec.kind === 7 || rec.kind === 16 || rec.kind === 6 || rec.kind === 1111 || rec.kind === 9735
      if (!isReaction) return false
      const eTags = rec.event.tags.filter((t: any) => t[0] === 'e').map((t: any) => t[1])
      return eTags.includes(event.id)
    }).toArray()

    const reactionCount = reactions.filter(r => r.kind === 7).length
    const repostCount = reactions.filter(r => r.kind === 6 || r.kind === 16).length
    const replyCount = reactions.filter(r => r.kind === 1111).length
    const zaps = reactions.filter(r => r.kind === 9735)
    const zapCount = zaps.length
    let zapTotalSats = 0
    zaps.forEach(z => {
      const bolt11 = z.event.tags.find((t: any) => t[0] === 'bolt11')?.[1]
      // simplified sat estimation from tags if bolt11 is not parsed:
      const descriptionTag = z.event.tags.find((t: any) => t[0] === 'description')?.[1]
      if (descriptionTag) {
        try {
          const parsedDesc = JSON.parse(descriptionTag)
          const amount = parsedDesc.tags.find((t: any) => t[0] === 'amount')?.[1]
          if (amount) zapTotalSats += Math.floor(parseInt(amount, 10) / 1000)
        } catch (_) {}
      }
    })

    let shape: VideoShape = {
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      firstSeen: existing?.firstSeen ?? Date.now(),
      insertOrder: existing?.insertOrder ?? nextInsertOrder(),
      videoUrl,
      thumbnailUrl,
      title,
      summary,
      hashtags: finalHashtags,
      mimeType,
      size,
      duration,
      mediaStatus,
      contentWarning,
      userState,
      reactionCount,
      repostCount,
      replyCount,
      zapCount,
      zapTotalSats,
      updatedAt: Date.now()
    }

    await db.videoShapes.put(shape)
    return shape
  } catch (err) {
    console.error('[Cache] Failed to build video shape:', err)
    return null
  }
}

export async function updateMediaStatus(url: string, status: MediaStatusRecord['status'], extra?: { size?: number; duration?: number }): Promise<void> {
  const updateRec: MediaStatusRecord = {
    url,
    status,
    size: extra?.size,
    duration: extra?.duration,
    updatedAt: Date.now()
  }
  await db.mediaStatus.put(updateRec)

  // Find all shapes with this videoUrl and update them
  const shapes = await db.videoShapes.where('videoUrl').equals(url).toArray()
  for (const s of shapes) {
    await db.videoShapes.put({
      ...s,
      mediaStatus: status,
      size: extra?.size ?? s.size,
      duration: extra?.duration ?? s.duration,
      updatedAt: Date.now()
    })
  }
}

export async function updateUserVideoState(id: string, state: Partial<Omit<UserVideoStateRecord, 'id' | 'updatedAt'>>): Promise<void> {
  const existing = await db.userVideoState.get(id)
  const updatedRec: UserVideoStateRecord = {
    id,
    watched: state.watched ?? existing?.watched,
    skipped: state.skipped ?? existing?.skipped,
    liked: state.liked ?? existing?.liked,
    zapped: state.zapped ?? existing?.zapped,
    updatedAt: Date.now()
  }
  await db.userVideoState.put(updatedRec)

  // Sync back to VideoShape
  const shape = await db.videoShapes.get(id)
  if (shape) {
    await db.videoShapes.put({
      ...shape,
      userState: {
        watched: updatedRec.watched,
        skipped: updatedRec.skipped,
        liked: updatedRec.liked,
        zapped: updatedRec.zapped
      },
      updatedAt: Date.now()
    })
  }
}

export async function buildOrUpdateAuthorProfile(event: any): Promise<CreatorProfileRecord | null> {
  if (event.kind !== 0) return null
  try {
    const data = JSON.parse(event.content)
    const name = data.name || data.display_name || event.pubkey.slice(0, 8)
    const profile: CreatorProfileRecord = {
      pubkey: event.pubkey,
      name,
      displayName: data.display_name || name,
      picture: data.picture || data.image,
      nip05: data.nip05,
      isVerified: !!data.nip05,
      about: data.about,
      website: data.website,
      updatedAt: Date.now()
    }
    await db.authorProfiles.put(profile)

    // Update username/profile fields in related video shapes
    const shapes = await db.videoShapes.where('pubkey').equals(event.pubkey).toArray()
    for (const s of shapes) {
      await db.videoShapes.put({
        ...s,
        authorName: profile.name,
        authorPicture: profile.picture,
        updatedAt: Date.now()
      })
    }
    return profile
  } catch (err) {
    console.error('[Cache] Failed to project profile event:', err)
    return null
  }
}

export async function buildOrUpdateSocialRelations(event: any): Promise<void> {
  if (event.kind !== 3) return
  try {
    const pubkey = event.pubkey
    const followingPubkeys = event.tags.filter((t: any) => t[0] === 'p').map((t: any) => t[1])
    
    // Clear old following relation entries for this pubkey
    await db.socialRelations.where('[pubkey+relationType]').equals([pubkey, 'following']).delete()

    // Bulk insert new following relation entries
    const records = followingPubkeys.map((target: string): SocialRelationRecord => ({
      pubkey,
      targetPubkey: target,
      relationType: 'following',
      updatedAt: Date.now()
    }))

    if (records.length > 0) {
      await db.socialRelations.bulkPut(records)
    }
  } catch (err) {
    console.error('[Cache] Failed to project contact list event:', err)
  }
}

/**
 * Saves a Nostr event to IndexedDB, enforcing LRU eviction rules.
 */
export async function saveEventToCache(event: any): Promise<void> {
  if (!event || !event.id || typeof event.kind !== 'number') return

  const { id, kind, pubkey, created_at } = event
  const last_accessed_at = Date.now()

  // We only cache specific events of interest
  const isVideo = kind === 21 || kind === 22 || kind === 34236
  const isReactionOrComment = kind === 7 || kind === 16 || kind === 9735 || kind === 1111
  const isProfileOrContact = kind === 0 || kind === 3

  if (!isVideo && !isReactionOrComment && !isProfileOrContact) {
    return
  }

  try {
    // 1. Write the event to IndexedDB
    await db.cachedEvents.put({
      id,
      kind,
      pubkey,
      created_at,
      last_accessed_at,
      event
    })

    // 2. Project to tables
    if (isVideo) {
      await buildOrUpdateVideoShape(event)
      await pruneVideos()
    } else if (isReactionOrComment) {
      // If reaction/comment, check which video it refers to and re-build its shape
      const eTags = event.tags.filter((t: any) => t[0] === 'e').map((t: any) => t[1])
      for (const eId of eTags) {
        const videoEventRecord = await db.cachedEvents.get(eId)
        if (videoEventRecord) {
          await buildOrUpdateVideoShape(videoEventRecord.event)
        }
      }
      await pruneReactions()
    } else if (isProfileOrContact) {
      if (kind === 0) {
        await buildOrUpdateAuthorProfile(event)
      } else if (kind === 3) {
        await buildOrUpdateSocialRelations(event)
      }
      await pruneProfiles()
    }
  } catch (error) {
    console.error(`[Cache] Error saving event ${id} to cache:`, error)
  }
}

/**
 * Prunes video events (kind 21, 22, 34236) to MAX_VIDEOS,
 * and performs cascading delete on reactions/comments for pruned videos.
 */
async function pruneVideos(): Promise<void> {
  const videos = await getLeastRecentlyUsedRecords([21, 22, 34236])

  if (videos.length > MAX_VIDEOS) {
    const overflowCount = videos.length - MAX_VIDEOS
    const videosToEvict = videos.slice(0, overflowCount)
    const evictedIds = videosToEvict.map((v) => v.id)

    console.log(`[Cache] Evicting ${overflowCount} old videos from cache.`)
    
    // Delete the videos
    await db.cachedEvents.bulkDelete(evictedIds)
    await db.videoShapes.bulkDelete(evictedIds)

    // Cascading delete: Remove reactions/comments corresponding to evicted video IDs
    // Since reaction/comment events store the video id in 'e' tags, we scan them.
    const allReactions = await db.cachedEvents
      .where('kind')
      .anyOf([7, 16, 9735, 1111])
      .toArray()

    const reactionsToEvict: string[] = []
    allReactions.forEach((record) => {
      const eTags = record.event.tags.filter((t: any) => t[0] === 'e').map((t: any) => t[1])
      // If the reaction references any of the evicted videos, evict it too
      if (eTags.some((id: string) => evictedIds.includes(id))) {
        reactionsToEvict.push(record.id)
      }
    })

    if (reactionsToEvict.length > 0) {
      console.log(`[Cache] Cascading delete: Evicting ${reactionsToEvict.length} reactions referencing evicted videos.`)
      await db.cachedEvents.bulkDelete(reactionsToEvict)
    }
  }
}

/**
 * Prunes reactions/comments to MAX_REACTIONS_COMMENTS limit.
 */
async function pruneReactions(): Promise<void> {
  const reactions = await getLeastRecentlyUsedRecords([7, 16, 9735, 1111])

  if (reactions.length > MAX_REACTIONS_COMMENTS) {
    const overflowCount = reactions.length - MAX_REACTIONS_COMMENTS
    const evictIds = reactions.slice(0, overflowCount).map((r) => r.id)
    await db.cachedEvents.bulkDelete(evictIds)
    console.log(`[Cache] Evicting ${overflowCount} oldest reactions from cache to stay under limit.`)
  }
}

/**
 * Prunes profile/contact metadata to MAX_PROFILES limit.
 */
async function pruneProfiles(): Promise<void> {
  const profiles = await getLeastRecentlyUsedRecords([0, 3])

  if (profiles.length > MAX_PROFILES) {
    const overflowCount = profiles.length - MAX_PROFILES
    const evictIds = profiles.slice(0, overflowCount).map((p) => p.id)
    await db.cachedEvents.bulkDelete(evictIds)
    console.log(`[Cache] Evicting ${overflowCount} oldest profiles from cache.`)
  }
}

export async function touchCachedEvents(ids: string[]): Promise<void> {
  if (ids.length === 0) return

  const timestamp = Date.now()
  await Promise.all(
    ids.map((id) =>
      db.cachedEvents.update(id, {
        last_accessed_at: timestamp
      })
    )
  )
}

export function queueCachedEventTouches(ids: string[]): void {
  for (const id of ids) {
    pendingTouchIds.add(id)
  }

  if (touchFlushTimer) return

  touchFlushTimer = setTimeout(() => {
    const idsToTouch = [...pendingTouchIds]
    pendingTouchIds.clear()
    touchFlushTimer = null
    void touchCachedEvents(idsToTouch)
  }, TOUCH_DEBOUNCE_MS)
}

async function getLeastRecentlyUsedRecords(kinds: number[]): Promise<CachedEvent[]> {
  const records = await db.cachedEvents.where('kind').anyOf(kinds).toArray()

  return records.sort((a, b) => {
    const aTouched = a.last_accessed_at ?? a.created_at
    const bTouched = b.last_accessed_at ?? b.created_at
    return aTouched - bTouched
  })
}

/**
 * Returns the total number of video events currently in the cache.
 * Used by the backfill engine to know whether the cache needs more history.
 */
export async function getCacheVideoCount(): Promise<number> {
  return db.cachedEvents.where('kind').anyOf([21, 22, 34236]).count()
}

/**
 * Returns the unix timestamp of the oldest video event in the cache,
 * or null when the cache is empty.
 * Used by the backfill engine to walk backwards through relay history.
 */
export async function getCacheOldestVideoTimestamp(): Promise<number | null> {
  const oldest = await db.cachedEvents
    .where('kind')
    .anyOf([21, 22, 34236])
    .sortBy('created_at')
  if (oldest.length === 0) return null
  return oldest[0].created_at
}
