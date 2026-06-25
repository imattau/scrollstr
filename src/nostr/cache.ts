import Dexie, { type Table } from 'dexie'

let insertOrderCounter = 0
function nextInsertOrder(): number {
  return Date.now() * 1000 + (++insertOrderCounter % 1000)
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

class ScrollstrCacheDatabase extends Dexie {
  cachedEvents!: Table<CachedEvent, string>
  videoShapes!: Table<VideoShape, string>
  mediaStatus!: Table<MediaStatusRecord, string>
  userVideoState!: Table<UserVideoStateRecord, string>
  authorProfiles!: Table<CreatorProfileRecord, string>

  constructor() {
    super('scrollstr-event-cache')
    this.version(10).stores({
      cachedEvents: 'id, [kind+pubkey], kind, pubkey, created_at, *eTags, *pTags',
      videoShapes: 'id, pubkey, created_at, videoUrl, insertOrder, *hashtags, mediaStatus',
      mediaStatus: 'url, status',
      userVideoState: 'id',
      authorProfiles: 'pubkey',
    }).upgrade(async tx => {
      await tx.table('cachedEvents').toCollection().modify(event => {
        event.eTags = (event.event?.tags || []).filter((t: any) => t[0] === 'e').map((t: any) => t[1])
        event.pTags = (event.event?.tags || []).filter((t: any) => t[0] === 'p').map((t: any) => t[1])
      })
    })
  }
}

export const db = new ScrollstrCacheDatabase()

export const MAX_VIDEOS = 5000

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

    const cachedMedia = (existing?.videoUrl === videoUrl && existing?.mediaStatus !== 'unknown')
      ? null
      : await db.mediaStatus.get(videoUrl)
    const mediaStatus = cachedMedia?.status ?? existing?.mediaStatus ?? 'unknown'
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
      reactionCount: existing?.reactionCount ?? 0,
      repostCount: existing?.repostCount ?? 0,
      replyCount: existing?.replyCount ?? 0,
      zapCount: existing?.zapCount ?? 0,
      zapTotalSats: existing?.zapTotalSats ?? 0,
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
  await db.mediaStatus.put({
    url,
    status,
    size: extra?.size,
    duration: extra?.duration,
    updatedAt: Date.now()
  })

  await db.videoShapes
    .where('videoUrl')
    .equals(url)
    .modify((shape) => {
      shape.mediaStatus = status
      if (extra?.size !== undefined) shape.size = extra.size
      if (extra?.duration !== undefined) shape.duration = extra.duration
      shape.updatedAt = Date.now()
    })
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
    const profile: CreatorProfileRecord = {
      pubkey: event.pubkey,
      name,
      displayName: data.display_name || name,
      picture,
      nip05: data.nip05,
      isVerified: !!data.nip05,
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

  const { id, kind, pubkey, created_at } = event

  const isVideo = kind === 21 || kind === 22 || kind === 34236
  const isReactionOrComment = kind === 7 || kind === 16 || kind === 9735 || kind === 1111

  try {
    const alreadyCached = await db.cachedEvents.get(id)
    if (alreadyCached) return

    const eTags = (event.tags || []).filter((t: any) => t[0] === 'e').map((t: any) => t[1])
    const pTags = (event.tags || []).filter((t: any) => t[0] === 'p').map((t: any) => t[1])

    await db.cachedEvents.put({ id, kind, pubkey, created_at, event, eTags, pTags })

    if (isVideo) {
      await buildOrUpdateVideoShape(event)
    } else if (isReactionOrComment) {
      for (const eId of eTags) {
        await incrementVideoCounts(eId, event)
      }
    } else if (kind === 0) {
      await buildOrUpdateAuthorProfile(event)
    }
  } catch (error) {
    console.error(`[Cache] Error saving event ${id} to cache:`, error)
  }
}

async function incrementVideoCounts(videoId: string, reactionEvent: any): Promise<void> {
  const shape = await db.videoShapes.get(videoId)
  if (!shape) return

  const kind = reactionEvent.kind
  if (kind === 7) {
    shape.reactionCount = (shape.reactionCount ?? 0) + 1
  } else if (kind === 6 || kind === 16) {
    shape.repostCount = (shape.repostCount ?? 0) + 1
  } else if (kind === 1111) {
    shape.replyCount = (shape.replyCount ?? 0) + 1
  } else if (kind === 9735) {
    shape.zapCount = (shape.zapCount ?? 0) + 1
    const descriptionTag = reactionEvent.tags.find((t: any) => t[0] === 'description')?.[1]
    if (descriptionTag) {
      try {
        const parsedDesc = JSON.parse(descriptionTag)
        const amount = parsedDesc.tags.find((t: any) => t[0] === 'amount')?.[1]
        if (amount) {
          shape.zapTotalSats = (shape.zapTotalSats ?? 0) + Math.floor(parseInt(amount, 10) / 1000)
        }
      } catch (_) {}
    }
  }

  shape.updatedAt = Date.now()
  await db.videoShapes.put(shape)
}

export async function getCacheVideoCount(): Promise<number> {
  return db.cachedEvents.where('kind').anyOf([21, 22, 34236]).count()
}

export async function getCacheOldestVideoTimestamp(): Promise<number | null> {
  const oldest = await db.cachedEvents
    .where('kind')
    .anyOf([21, 22, 34236])
    .sortBy('created_at')
  if (oldest.length === 0) return null
  return oldest[0].created_at
}
