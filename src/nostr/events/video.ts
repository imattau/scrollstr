import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
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
    // Real dynamic totals will be fetched through subscriptions in Milestones 3 & 4
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
