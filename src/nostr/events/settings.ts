import { loadSettings, saveSettings } from '../../db/local-preferences'
import { publishToRelays, activeRelays } from '../pool'

// Publish kind:10002 relay list metadata
export const publishRelayList = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  _pool: any,
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

// Publish kind:10063 Blossom servers list
export const publishBlossomList = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  _pool: any,
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

// Publish kind:10000 mute list
export const publishMuteList = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  _pool: any,
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

// Publish kind:10096 NIP-96 media servers list
export const publishNip96List = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  _pool: any,
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
