import { VideoItemData, CreatorProfile } from '../../features/feed/VideoFeedItem'
import { publishToRelays, activeRelays } from '../pool'

// ── Video ────────────────────────────────────────────────────────────────────

export const parseImetaTag = (imetaTag: string[]): Record<string, string> => {
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

export const parseVideoEvent = (event: any): VideoItemData | null => {
  try {
    const titleTag = event.tags.find((t: any) => t[0] === 'title')
    const title = titleTag ? titleTag[1] : ''

    const altTag = event.tags.find((t: any) => t[0] === 'alt')
    const alt = altTag ? altTag[1] : ''

    const hashtags = event.tags.filter((t: any) => t[0] === 't').map((t: any) => t[1])

    const imetaTag = event.tags.find((t: any) => t[0] === 'imeta')
    if (!imetaTag) return null

    const imetaData = parseImetaTag(imetaTag)
    const url = imetaData['url']
    if (!url) return null

    const creator: CreatorProfile = {
      pubkey: event.pubkey,
      name: event.pubkey.slice(0, 8),
    }

    return {
      id: event.id,
      kind: event.kind,
      createdAt: event.created_at,
      title,
      description: event.content || alt,
      url,
      poster: imetaData['image'],
      creator,
      hashtags,
      likesCount: 0,
      commentsCount: 0,
      boostsCount: 0,
      zapsCount: 0,
      music: 'Original Clip Audio',
    }
  } catch (err) {
    console.error('Failed to parse video event:', err)
    return null
  }
}

export const publishVideoEvent = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  videoUrl: string,
  videoHash: string,
  posterUrl: string,
  title: string,
  description: string,
  hashtags: string[]
): Promise<any> => {
  const eventTemplate = {
    kind: 22,
    content: description,
    tags: [
      ['title', title],
      ['published_at', Math.floor(Date.now() / 1000).toString()],
      ['alt', title],
      ...hashtags.map((tag) => ['t', tag.trim().toLowerCase()]),
      ['imeta', `url ${videoUrl}`, `m video/mp4`, `x ${videoHash}`, `image ${posterUrl}`],
    ],
  }

  console.log('Signing and publishing kind:22 event...')
  const signed = await signEvent(eventTemplate)
  try {
    await publishToRelays(activeRelays, signed)
  } catch (err) {
    console.warn('Failed to broadcast video event to relays:', err)
  }
  return signed
}

// ── Reactions ────────────────────────────────────────────────────────────────

export const publishLike = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  targetEventId: string,
  targetAuthorPubkey: string,
  targetEventKind = 22
): Promise<any> => {
  const eventTemplate = {
    kind: 7,
    content: '❤️',
    tags: [
      ['e', targetEventId],
      ['p', targetAuthorPubkey],
      ['k', String(targetEventKind)],
    ],
  }

  console.log(`Signing and publishing Like event for ${targetEventId}...`)
  const signed = await signEvent(eventTemplate)
  try {
    await publishToRelays(activeRelays, signed)
  } catch (err) {
    console.warn('Failed to broadcast Like event to relays:', err)
  }
  return signed
}

export const publishBoost = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  targetEventId: string,
  targetAuthorPubkey: string,
  targetEventKind = 22
): Promise<any> => {
  const eventTemplate = {
    kind: 16,
    content: '',
    tags: [
      ['e', targetEventId, '', 'mention'],
      ['p', targetAuthorPubkey],
      ['k', String(targetEventKind)],
    ],
  }

  console.log(`Signing and publishing Boost event for ${targetEventId}...`)
  const signed = await signEvent(eventTemplate)
  try {
    await publishToRelays(activeRelays, signed)
  } catch (err) {
    console.warn('Failed to broadcast Boost event to relays:', err)
  }
  return signed
}

export const publishFollow = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  creatorPubkey: string,
  currentContactListEvent: any | null
): Promise<{ signed: any; action: 'follow' | 'unfollow' }> => {
  let isFollowing = false
  let newTags: string[][]

  if (currentContactListEvent && currentContactListEvent.tags) {
    isFollowing = currentContactListEvent.tags.some((t: any) => t[0] === 'p' && t[1] === creatorPubkey)
    newTags = isFollowing
      ? currentContactListEvent.tags.filter((t: any) => !(t[0] === 'p' && t[1] === creatorPubkey))
      : [...currentContactListEvent.tags, ['p', creatorPubkey]]
  } else {
    newTags = [['p', creatorPubkey]]
  }

  const eventTemplate = {
    kind: 3,
    content: currentContactListEvent?.content || '',
    tags: newTags,
  }

  const action = isFollowing ? 'unfollow' : 'follow'
  console.log(`Signing and publishing Contact list (kind:3) for ${action} of ${creatorPubkey}...`)
  const signed = await signEvent(eventTemplate)
  try {
    await publishToRelays(activeRelays, signed)
  } catch (err) {
    console.warn(`Failed to broadcast contact list (${action}) event to relays:`, err)
  }
  return { signed, action }
}

// ── Comments ─────────────────────────────────────────────────────────────────

export const publishComment = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  targetEventId: string,
  targetAuthorPubkey: string,
  commentText: string
): Promise<any> => {
  const eventTemplate = {
    kind: 1111,
    content: commentText,
    tags: [
      ['e', targetEventId, '', 'root'],
      ['p', targetAuthorPubkey],
    ],
  }

  console.log(`Signing and publishing comment for ${targetEventId}: "${commentText}"`)
  const signed = await signEvent(eventTemplate)
  try {
    await publishToRelays(activeRelays, signed)
  } catch (err) {
    console.warn('Failed to broadcast comment to relays:', err)
  }
  return signed
}

// ── Settings ─────────────────────────────────────────────────────────────────

import { loadSettings, saveSettings } from '../../db/local-preferences'

export const publishRelayList = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  relays: { url: string; read: boolean; write: boolean }[]
): Promise<any> => {
  const tags = relays.map((r) => {
    const tag = ['r', r.url]
    if (r.read && !r.write) {
      tag.push('read')
    } else if (r.write && !r.read) {
      tag.push('write')
    }
    return tag
  })

  const eventTemplate = {
    kind: 10002,
    content: '',
    tags,
  }

  console.log('Signing and publishing relay list (kind:10002)...')
  const signed = await signEvent(eventTemplate)
  try {
    await publishToRelays(activeRelays, signed)
  } catch (err) {
    console.warn('Failed to broadcast relay list to relays:', err)
  }

  try {
    const current = loadSettings()
    saveSettings({
      ...current,
      relays: relays.map((relay) => relay.url),
    })
  } catch (err) {
    console.warn('Failed to persist local relay list settings:', err)
  }

  return signed
}

export const publishBlossomList = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  servers: string[]
): Promise<any> => {
  const tags = servers.map((url) => ['server', url])

  const eventTemplate = {
    kind: 10063,
    content: '',
    tags,
  }

  console.log('Signing and publishing Blossom servers list (kind:10063)...')
  const signed = await signEvent(eventTemplate)
  try {
    await publishToRelays(activeRelays, signed)
  } catch (err) {
    console.warn('Failed to broadcast Blossom list to relays:', err)
  }
  return signed
}

export const publishMuteList = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  pubkeys: string[],
  hashtags: string[]
): Promise<any> => {
  const tags: string[][] = []
  pubkeys.forEach((pk) => tags.push(['p', pk]))
  hashtags.forEach((tag) => tags.push(['t', tag]))

  const eventTemplate = {
    kind: 10000,
    content: '',
    tags,
  }

  console.log('Signing and publishing mute list (kind:10000)...')
  const signed = await signEvent(eventTemplate)
  try {
    await publishToRelays(activeRelays, signed)
  } catch (err) {
    console.warn('Failed to broadcast mute list to relays:', err)
  }
  return signed
}

export const publishNip96List = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  servers: string[]
): Promise<any> => {
  const tags = servers.map((url) => ['server', url])

  const eventTemplate = {
    kind: 10096,
    content: '',
    tags,
  }

  console.log('Signing and publishing NIP-96 media servers list (kind:10096)...')
  const signed = await signEvent(eventTemplate)
  try {
    await publishToRelays(activeRelays, signed)
  } catch (err) {
    console.warn('Failed to broadcast NIP-96 list to relays:', err)
  }
  return signed
}
