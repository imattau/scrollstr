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
  try {
    await rxNostr.cast(signed)
  } catch (err) {
    console.warn('Failed to broadcast Like event to relays:', err)
  }
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
  try {
    await rxNostr.cast(signed)
  } catch (err) {
    console.warn('Failed to broadcast Boost event to relays:', err)
  }
  return signed
}

// Publish updated kind:3 contact list to follow/unfollow a user pubkey
export const publishFollow = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  rxNostr: any,
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
    // No contact list event yet, create first follow
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
    await rxNostr.cast(signed)
  } catch (err) {
    console.warn(`Failed to broadcast contact list (${action}) event to relays:`, err)
  }
  return { signed, action }
}
