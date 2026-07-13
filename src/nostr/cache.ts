import Dexie, { type Table } from 'dexie'
import { verifyEvent } from 'nostr-tools'

let insertOrderCounter = 0
let lastInsertOrderTs = 0
function nextInsertOrder(): number {
  const now = Date.now() * 1000
  const ts = now > lastInsertOrderTs ? now : lastInsertOrderTs + 1
  lastInsertOrderTs = ts
  return ts + (++insertOrderCounter)
}

export interface CachedEvent {
  id: string
  kind: number
  pubkey: string
  created_at: number
  event: any
  eTags?: string[]
  pTags?: string[]
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

class ScrollstrCacheDatabase extends Dexie {
  cachedEvents!: Table<CachedEvent, string>
  videoShapes!: Table<VideoShape, string>
  mediaStatus!: Table<MediaStatusRecord, string>
  userVideoState!: Table<UserVideoStateRecord, string>
  authorProfiles!: Table<CreatorProfileRecord, string>
  videoCounters!: Table<VideoCountersRecord, string>
  kindOneRejections!: Table<KindOneRejectionRecord, string>

  constructor() {
    super('scrollstr-event-cache')
    this.version(12).stores({
      cachedEvents: 'id, [kind+pubkey], [pubkey+kind], kind, pubkey, created_at, *eTags, *pTags',
      videoShapes: 'id, pubkey, created_at, videoUrl, insertOrder, *hashtags, mediaStatus, isFailed',
      mediaStatus: 'url, status',
      userVideoState: 'id',
      authorProfiles: 'pubkey',
      videoCounters: 'id',
      kindOneRejections: 'id, checkedAt',
    })
  }
}

export const db = new ScrollstrCacheDatabase()

export const MAX_VIDEOS = 10000
const PRUNE_INTERVAL = 30
let _saveCounter = 0

export async function pruneCache(): Promise<void> {
  const totalShapes = await db.videoShapes.count()
  const excess = totalShapes - MAX_VIDEOS
  if (excess <= 0) return

  const oldestShapes = await db.videoShapes
    .orderBy('insertOrder')
    .limit(excess)
    .toArray()

  const oldestIds = oldestShapes.map(s => s.id)
  const videoUrls = oldestShapes.filter(s => s.videoUrl).map(s => s.videoUrl!)

  const reactionIds = await db.cachedEvents
    .where('eTags')
    .anyOf(oldestIds)
    .filter(e => [7, 16, 9735, 1111].includes(e.kind))
    .primaryKeys()

  await db.cachedEvents.bulkDelete([...reactionIds, ...oldestIds])
  await db.videoShapes.bulkDelete(oldestIds)
  await db.userVideoState.bulkDelete(oldestIds)

  // Clean up kindOneRejections for pruned videos and old entries
  await db.kindOneRejections.bulkDelete(oldestIds)
  const oldRejectionThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000
  await db.kindOneRejections.where('checkedAt').below(oldRejectionThreshold).delete()

  if (videoUrls.length > 0) {
    await db.mediaStatus.where('url').anyOf(videoUrls).delete()
  }

  // Prune author profiles not referenced by any remaining video shape
  const remainingPubkeys = await db.videoShapes
    .orderBy('pubkey')
    .uniqueKeys()
  await db.authorProfiles
    .filter(p => !remainingPubkeys.includes(p.pubkey))
    .delete()
}

export async function pruneBlockedContent(pubkeys: string[]): Promise<void> {
  if (pubkeys.length === 0) return

  const shapes = await db.videoShapes
    .where('pubkey')
    .anyOf(pubkeys)
    .toArray()

  if (shapes.length === 0) return

  const shapeIds = shapes.map(s => s.id)
  const videoUrls = shapes.filter(s => s.videoUrl).map(s => s.videoUrl!)

  const reactionIds = await db.cachedEvents
    .where('eTags')
    .anyOf(shapeIds)
    .filter(e => [7, 16, 9735, 1111].includes(e.kind))
    .primaryKeys()

  await db.cachedEvents.bulkDelete([...reactionIds, ...shapeIds])
  await db.videoShapes.bulkDelete(shapeIds)
  await db.userVideoState.bulkDelete(shapeIds)
  await db.kindOneRejections.bulkDelete(shapeIds)

  if (videoUrls.length > 0) {
    await db.mediaStatus.where('url').anyOf(videoUrls).delete()
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

export async function buildOrUpdateVideoShape(event: any): Promise<VideoShape | null> {
  const isVideo = event.kind === 1 || event.kind === 21 || event.kind === 22 || event.kind === 34236
  if (!isVideo) return null

  try {
    if (event.kind === 1) {
      return await db.transaction('rw', db.videoShapes, db.userVideoState, async () => {
        const videoUrl = extractVideoUrlFromContent(event.content || '')
        if (!videoUrl) return null

        const hashtags = event.tags.filter((t: any) => t[0] === 't').map((t: any) => t[1])
        const existing = await db.videoShapes.get(event.id)

        const cachedUserState = existing ? await db.userVideoState.get(event.id) : undefined
        const userState = cachedUserState ? {
          watched: cachedUserState.watched,
          skipped: cachedUserState.skipped,
          liked: cachedUserState.liked,
          boosted: cachedUserState.boosted,
          zapped: cachedUserState.zapped
        } : existing?.userState

        const shape: VideoShape = {
          id: event.id,
          kind: event.kind,
          pubkey: event.pubkey,
          created_at: event.created_at,
          firstSeen: existing?.firstSeen ?? Date.now(),
          insertOrder: existing?.insertOrder ?? nextInsertOrder(),
          videoUrl,
          thumbnailUrl: existing?.thumbnailUrl,
          title: existing?.title ?? '',
          summary: event.content || (existing?.summary ?? ''),
          hashtags: hashtags.length > 0 ? hashtags : (existing?.hashtags ?? []),
          mimeType: existing?.mimeType,
          size: existing?.size,
          duration: existing?.duration,
          mediaStatus: existing?.mediaStatus ?? 'unknown',
          isFailed: existing?.mediaStatus === 'failed',
          contentWarning: existing?.contentWarning,
          userState,
          reactionCount: existing?.reactionCount ?? 0,
          repostCount: existing?.repostCount ?? 0,
          replyCount: existing?.replyCount ?? 0,
          zapCount: existing?.zapCount ?? 0,
          zapTotalSats: existing?.zapTotalSats ?? 0,
          updatedAt: Date.now()
        }

        await db.videoShapes.put(shape)
        return shape
      })
    }

    return await db.transaction('rw', db.videoShapes, db.userVideoState, db.mediaStatus, async () => {
      const existing = await db.videoShapes.get(event.id)

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

      if (!videoUrl) return null

      const cachedMedia = (existing?.videoUrl === videoUrl && existing?.mediaStatus !== 'unknown')
        ? null
        : await db.mediaStatus.get(videoUrl)
      const mediaStatus = cachedMedia?.status ?? existing?.mediaStatus ?? 'unknown'
      const isFailed = mediaStatus === 'failed'
      const duration = cachedMedia?.duration ?? existing?.duration

      const cachedUserState = existing ? await db.userVideoState.get(event.id) : undefined
      const userState = cachedUserState ? {
        watched: cachedUserState.watched,
        skipped: cachedUserState.skipped,
        liked: cachedUserState.liked,
        boosted: cachedUserState.boosted,
        zapped: cachedUserState.zapped
      } : existing?.userState

      const shape: VideoShape = {
        id: event.id,
        kind: event.kind,
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
        isFailed,
        contentWarning,
        userState,
        reactionCount: existing?.reactionCount ?? 0,
        repostCount: existing?.repostCount ?? 0,
        replyCount: existing?.replyCount ?? 0,
        zapCount: existing?.zapCount ?? 0,
        zapTotalSats: existing?.zapTotalSats ?? 0,
        updatedAt: Date.now()
      }

      await db.videoShapes.put(shape)
      return shape
    })
  } catch (err) {
    console.error('[Cache] Failed to build video shape:', err)
    return null
  }
}

export async function updateMediaStatus(url: string, status: MediaStatusRecord['status'], extra?: { size?: number; duration?: number }): Promise<void> {
  await db.mediaStatus.put({
    url,
    status,
    size: extra?.size,
    duration: extra?.duration,
    updatedAt: Date.now()
  })

  // Only propagate failure status to videoShapes — this avoids triggering feed
  // re-renders from HEAD probes and metadata loading while still showing error
  // states in the feed. Success/available updates are read from the mediaStatus
  // table when needed and don't affect the cached shape.
  if (status === 'failed') {
    await db.videoShapes
      .where('videoUrl')
      .equals(url)
      .modify((shape) => {
        shape.mediaStatus = status
        shape.isFailed = true
        if (extra?.size !== undefined) shape.size = extra.size
        if (extra?.duration !== undefined) shape.duration = extra.duration
        shape.updatedAt = Date.now()
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
    boosted: state.boosted ?? existing?.boosted,
    zapped: state.zapped ?? existing?.zapped,
    updatedAt: Date.now()
  }
  await db.userVideoState.put(updatedRec)

  const shape = await db.videoShapes.get(id)
  if (shape) {
    await db.videoShapes.put({
      ...shape,
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

export async function buildOrUpdateAuthorProfile(event: any): Promise<CreatorProfileRecord | null> {
  if (event.kind !== 0) return null
  try {
    const data = JSON.parse(event.content)
    const name = data.name || data.display_name || event.pubkey.slice(0, 8)
    const picture = data.picture || data.image
    // Note: isVerified is set to false because NIP-05 DNS verification is not
    // performed client-side. Setting it based solely on the presence of a nip05
    // field is misleading. Full NIP-05 verification would require an HTTP fetch
    // to the user's domain at /.well-known/nostr.json?name=<local>.
    const profile: CreatorProfileRecord = {
      pubkey: event.pubkey,
      name,
      displayName: data.display_name || name,
      picture,
      nip05: data.nip05,
      isVerified: false,
      about: data.about,
      website: data.website,
      updatedAt: Date.now()
    }

    // Check if profile data actually changed before writing — avoids expensive
    // videoShapes modify when a duplicate/older profile event arrives
    const existingProfile = await db.authorProfiles.get(event.pubkey)
    if (existingProfile && existingProfile.name === name && existingProfile.picture === picture) {
      return existingProfile
    }

    await db.authorProfiles.put(profile)

    // Update video shapes in-place — avoids loading each shape into memory
    await db.videoShapes
      .where('pubkey')
      .equals(event.pubkey)
      .modify({ authorName: name, authorPicture: picture, updatedAt: Date.now() })
    return profile
  } catch (err) {
    console.error('[Cache] Failed to project profile event:', err)
    return null
  }
}

export async function saveEventToCache(event: any): Promise<void> {
  if (!event || !event.id || typeof event.kind !== 'number') return

  // Reject events with invalid signatures — prevents relay injection attacks
  if (!event.sig) {
    console.warn(`[Cache] Rejected event ${event.id} — missing signature`)
    return
  }
  // Allow mock/development signatures (only present in dev builds)
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

  const { id, kind, pubkey, created_at } = event

  const isVideo = kind === 1 || kind === 21 || kind === 22 || kind === 34236
  const isReactionOrComment = kind === 7 || kind === 16 || kind === 9735 || kind === 1111

  let wroteCachedEvent = false
  const cleanup = async () => {
    if (wroteCachedEvent) {
      await db.cachedEvents.delete(id).catch(() => {})
      await db.videoShapes.delete(id).catch(() => {})
    }
  }

  try {
    // Fast-path: skip kind-1 notes already examined and rejected
    if (kind === 1) {
      const rejected = await db.kindOneRejections.get(id)
      if (rejected) return
      // Don't cache kind-1 notes without a video URL at all
      const videoUrl = extractVideoUrlFromContent(event.content || '')
      if (!videoUrl) {
        await db.kindOneRejections.put({ id, reason: 'no_video_url', checkedAt: Date.now() })
        return
      }
    }

    const alreadyCached = await db.cachedEvents.get(id)
    if (alreadyCached) return

    const eTags = (event.tags || []).filter((t: any) => t[0] === 'e').map((t: any) => t[1])
    const pTags = (event.tags || []).filter((t: any) => t[0] === 'p').map((t: any) => t[1])

    await db.cachedEvents.put({ id, kind, pubkey, created_at, event, eTags, pTags })
    wroteCachedEvent = true

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
  }
}

async function incrementVideoCounts(videoId: string, reactionEvent: any): Promise<void> {
  await db.transaction('rw', db.videoCounters, async () => {
    const kind = reactionEvent.kind
    const existing = await db.videoCounters.get(videoId) ?? { id: videoId, reactionCount: 0, repostCount: 0, replyCount: 0, zapCount: 0, zapTotalSats: 0 }

    if (kind === 7) {
      existing.reactionCount += 1
    } else if (kind === 6 || kind === 16) {
      existing.repostCount += 1
    } else if (kind === 1111) {
      existing.replyCount += 1
    } else if (kind === 9735) {
      existing.zapCount += 1
      const descriptionTag = reactionEvent.tags.find((t: any) => t[0] === 'description')?.[1]
      if (descriptionTag) {
        try {
          const parsedDesc = JSON.parse(descriptionTag)
          const amount = parsedDesc.tags.find((t: any) => t[0] === 'amount')?.[1]
          if (amount) {
            existing.zapTotalSats += Math.floor(parseInt(amount, 10) / 1000)
          }
        } catch (_) {}
      }
    }

    await db.videoCounters.put(existing)
  })
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
  const ids = shapes.map(s => s.id)
  const counters = await db.videoCounters.where('id').anyOf(ids).toArray()
  if (counters.length === 0) return shapes
  const counterMap = new Map(counters.map(c => [c.id, c]))
  return shapes.map(shape => {
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
  const oldest = await db.videoShapes
    .orderBy('created_at')
    .first()
  return oldest?.created_at ?? null
}
