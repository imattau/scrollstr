import Dexie, { type Table } from 'dexie'

export interface CachedEvent {
  id: string
  kind: number
  pubkey: string
  created_at: number
  last_accessed_at?: number
  event: any // The full signed Nostr event JSON
}

class ScrollstrCacheDatabase extends Dexie {
  cachedEvents!: Table<CachedEvent, string>

  constructor() {
    super('scrollstr-event-cache')
    this.version(1).stores({
      cachedEvents: 'id, kind, pubkey, created_at'
    })
  }
}

export const db = new ScrollstrCacheDatabase()

// Cache limits
const MAX_VIDEOS = 50
const MAX_REACTIONS_COMMENTS = 500
const MAX_PROFILES = 150
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
  } catch (error) {
    console.error('[Cache] Error loading cached events:', error)
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
  const isVideo = kind === 22 || kind === 34236
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

    // 2. Perform background LRU pruning based on category
    if (isVideo) {
      await pruneVideos()
    } else if (isReactionOrComment) {
      await pruneReactions()
    } else if (isProfileOrContact) {
      await pruneProfiles()
    }
  } catch (error) {
    console.error(`[Cache] Error saving event ${id} to cache:`, error)
  }
}

/**
 * Prunes video events (kind 22, 34236) to MAX_VIDEOS,
 * and performs cascading delete on reactions/comments for pruned videos.
 */
async function pruneVideos(): Promise<void> {
  const videos = await getLeastRecentlyUsedRecords([22, 34236])

  if (videos.length > MAX_VIDEOS) {
    const overflowCount = videos.length - MAX_VIDEOS
    const videosToEvict = videos.slice(0, overflowCount)
    const evictedIds = videosToEvict.map((v) => v.id)

    console.log(`[Cache] Evicting ${overflowCount} old videos from cache.`)
    
    // Delete the videos
    await db.cachedEvents.bulkDelete(evictedIds)

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
