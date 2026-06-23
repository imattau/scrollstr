import { publishToRelays, activeRelays } from '../pool'

// Publish a NIP-22 kind:1111 comment scoped to a kind:22 video event
export const publishComment = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  _pool: any, // kept for API compatibility — uses global pool
  targetEventId: string,
  targetAuthorPubkey: string,
  commentText: string
): Promise<any> => {
  const eventTemplate = {
    kind: 1111,
    content: commentText,
    tags: [
      ['e', targetEventId, '', 'root'], // Reference root event ID
      ['p', targetAuthorPubkey],        // Creator pubkey
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
