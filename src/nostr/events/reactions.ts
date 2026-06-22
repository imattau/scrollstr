import NDK, { NDKEvent } from '@nostr-dev-kit/ndk'

// Publish a kind:7 reaction (Like) for a specific video event
export const publishLike = async (
  ndk: NDK,
  targetEventId: string,
  targetAuthorPubkey: string
): Promise<NDKEvent> => {
  if (!ndk.signer) {
    throw new Error('Nostr signer not connected')
  }

  const event = new NDKEvent(ndk)
  event.kind = 7
  event.content = '❤️' // standard reaction content
  event.tags = [
    ['e', targetEventId],
    ['p', targetAuthorPubkey],
    ['k', '22'], // Target kind is kind 22 (short video)
  ]

  console.log(`Publishing Like event for ${targetEventId}...`)
  await event.publish()
  return event
}

// Publish a kind:16 generic repost (Boost) for a specific video event
export const publishBoost = async (
  ndk: NDK,
  targetEventId: string,
  targetAuthorPubkey: string
): Promise<NDKEvent> => {
  if (!ndk.signer) {
    throw new Error('Nostr signer not connected')
  }

  const event = new NDKEvent(ndk)
  event.kind = 16 // Generic repost kind
  event.content = ''
  event.tags = [
    ['e', targetEventId, '', 'mention'],
    ['p', targetAuthorPubkey],
    ['k', '22'], // Target kind is 22
  ]

  console.log(`Publishing Boost event for ${targetEventId}...`)
  await event.publish()
  return event
}
