// Publish a NIP-22 kind:1111 comment scoped to a kind:22 video event
export const publishComment = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  rxNostr: any,
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
    await rxNostr.cast(signed)
  } catch (err) {
    console.warn('Failed to broadcast comment to relays:', err)
  }
  return signed
}
