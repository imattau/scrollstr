import NDK, { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import { VideoItemData, CreatorProfile } from '../../features/feed/VideoFeedItem'

// Helper to parse space-separated imeta fields (e.g. "url https://example.com/a.mp4")
export const parseImetaTag = (imetaTag: string[]): Record<string, string> => {
  const data: Record<string, string> = {}
  
  // Tag elements starts with "imeta" followed by entries like "url https://..."
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

// Convert a Nostr kind:22 or kind:34236 event into our local VideoItemData format
export const parseVideoEvent = (event: NDKEvent): VideoItemData | null => {
  try {
    const titleTag = event.tags.find((t) => t[0] === 'title')
    const title = titleTag ? titleTag[1] : ''

    const altTag = event.tags.find((t) => t[0] === 'alt')
    const alt = altTag ? altTag[1] : ''

    const hashtags = event.tags.filter((t) => t[0] === 't').map((t) => t[1])

    // Find and parse the imeta tag
    const imetaTag = event.tags.find((t) => t[0] === 'imeta')
    if (!imetaTag) return null

    const imetaData = parseImetaTag(imetaTag)
    const url = imetaData['url']
    if (!url) return null

    // Extract likes, comments, zaps, boosts from tags if they are annotated, or fallback to 0
    const likesCount = 0
    const commentsCount = 0
    const boostsCount = 0
    const zapsCount = 0

    // Construct creator profile placeholder
    const creator: CreatorProfile = {
      pubkey: event.pubkey,
      name: event.pubkey.slice(0, 8),
    }

    return {
      id: event.id,
      title,
      description: event.content || alt,
      url,
      poster: imetaData['image'],
      creator,
      hashtags,
      likesCount,
      commentsCount,
      boostsCount,
      zapsCount,
      music: 'Original Clip Audio',
    }
  } catch (err) {
    console.error('Failed to parse video event:', err)
    return null
  }
}

// Fetch and attach creator profile details (kind:0) to the video creator object
export const fetchCreatorProfile = async (
  user: NDKUser
): Promise<Partial<CreatorProfile>> => {
  try {
    await user.fetchProfile()
    return {
      name: user.profile?.name || user.pubkey.slice(0, 8),
      displayName: user.profile?.displayName || user.profile?.name,
      picture: user.profile?.image || user.profile?.picture,
      nip05: user.profile?.nip05,
      isVerified: !!user.profile?.nip05,
    }
  } catch (err) {
    console.error(`Failed to fetch profile for ${user.pubkey}:`, err)
    return {}
  }
}

// Sign and broadcast a kind:22 Nostr video event to default relays
export const publishVideoEvent = async (
  ndk: NDK,
  videoUrl: string,
  videoHash: string,
  posterUrl: string,
  title: string,
  description: string,
  hashtags: string[]
): Promise<NDKEvent> => {
  if (!ndk.signer) {
    throw new Error('Nostr signer not available to publish clip')
  }

  const event = new NDKEvent(ndk)
  event.kind = 22 // immutable kind:22 video event
  event.content = description
  event.tags = [
    ['title', title],
    ['published_at', Math.floor(Date.now() / 1000).toString()],
    ['alt', title],
    ...hashtags.map((tag) => ['t', tag.trim().toLowerCase()]),
    [
      'imeta',
      `url ${videoUrl}`,
      `m video/mp4`,
      `x ${videoHash}`,
      `image ${posterUrl}`,
    ],
  ]

  console.log('Signing and publishing kind:22 event...')
  await event.publish()
  return event
}
