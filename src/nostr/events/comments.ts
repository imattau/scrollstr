import NDK, { NDKEvent } from '@nostr-dev-kit/ndk'

// Publish a NIP-22 kind:1111 comment scoped to a kind:22 video event
export const publishComment = async (
  ndk: NDK,
  targetEventId: string,
  targetAuthorPubkey: string,
  commentText: string
): Promise<NDKEvent> => {
  if (!ndk.signer) {
    throw new Error('Nostr signer not connected')
  }

  const event = new NDKEvent(ndk)
  event.kind = 1111 // NIP-22 comment event
  event.content = commentText
  event.tags = [
    ['e', targetEventId, '', 'root'], // Reference root event ID
    ['p', targetAuthorPubkey],        // Creator pubkey
  ]

  console.log(`Publishing comment for ${targetEventId}: "${commentText}"`)
  await event.publish()
  return event
}

// Fetch kind:1111 comments for a specific video event ID
export const fetchComments = async (
  ndk: NDK,
  targetEventId: string
): Promise<NDKEvent[]> => {
  const filter = {
    kinds: [1111],
    '#e': [targetEventId],
    limit: 50,
  }

  const events = await ndk.fetchEvents(filter)
  return Array.from(events)
}
