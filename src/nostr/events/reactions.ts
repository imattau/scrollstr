// Publish a kind:7 reaction (Like) for a specific video event
export const publishLike = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  rxNostr: any,
  targetEventId: string,
  targetAuthorPubkey: string
): Promise<any> => {
  const eventTemplate = {
    kind: 7,
    content: '❤️', // standard reaction content
    tags: [
      ['e', targetEventId],
      ['p', targetAuthorPubkey],
      ['k', '22'], // Target kind is kind 22 (short video)
    ],
  }

  console.log(`Signing and publishing Like event for ${targetEventId}...`)
  const signed = await signEvent(eventTemplate)
  await rxNostr.cast(signed)
  return signed
}

// Publish a kind:16 generic repost (Boost) for a specific video event
export const publishBoost = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  rxNostr: any,
  targetEventId: string,
  targetAuthorPubkey: string
): Promise<any> => {
  const eventTemplate = {
    kind: 16, // Generic repost kind
    content: '',
    tags: [
      ['e', targetEventId, '', 'mention'],
      ['p', targetAuthorPubkey],
      ['k', '22'], // Target kind is 22
    ],
  }

  console.log(`Signing and publishing Boost event for ${targetEventId}...`)
  const signed = await signEvent(eventTemplate)
  await rxNostr.cast(signed)
  return signed
}
