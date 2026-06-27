import type { AppSettings } from '../../db/local-preferences'
import { db } from '../cache'
import { publishToRelays, activeRelays } from '../pool'

const SETTINGS_KIND = 30078
const SETTINGS_D_TAG = 'scrollstr-settings'

type Nip44Crypto = {
  encrypt: (pubkey: string, plaintext: string) => Promise<string>
  decrypt: (pubkey: string, payload: string) => Promise<string>
}

export function getNip44(): Nip44Crypto | null {
  if (window.nostr?.nip44) return window.nostr.nip44
  return null
}

export function getNip44FromSigner(signer: any): Nip44Crypto | null {
  return signer?.nip44 ?? null
}

export function encryptSettingsJson(
  nip44: Nip44Crypto,
  pubkey: string,
  settings: Partial<AppSettings>
): Promise<string> {
  return nip44.encrypt(pubkey, JSON.stringify(settings))
}

export async function decryptSettingsJson(
  nip44: Nip44Crypto,
  pubkey: string,
  encryptedContent: string
): Promise<Partial<AppSettings> | null> {
  try {
    const json = await nip44.decrypt(pubkey, encryptedContent)
    return JSON.parse(json)
  } catch (err) {
    console.error('[settings] Failed to decrypt settings event:', err)
    return null
  }
}

export async function publishSettingsEvent(
  signEvent: (template: any) => Promise<any>,
  encryptedContent: string
): Promise<any> {
  const eventTemplate = {
    kind: SETTINGS_KIND,
    content: encryptedContent,
    tags: [['d', SETTINGS_D_TAG]],
  }

  const signed = await signEvent(eventTemplate)
  try {
    await publishToRelays(activeRelays, signed)
  } catch (err) {
    console.warn('[settings] Failed to broadcast settings event to relays:', err)
  }
  return signed
}

export async function loadRawSettingsEvent(pubkey: string): Promise<string | null> {
  const events = await db.cachedEvents
    .where({ kind: SETTINGS_KIND, pubkey })
    .toArray()

  const sorted = events.toSorted((a, b) => b.created_at - a.created_at)
  const latest = sorted[0]?.event
  if (!latest) return null

  const dTag = latest.tags?.find(
    (t: any) => t[0] === 'd' && t[1] === SETTINGS_D_TAG
  )
  if (!dTag) return null

  return latest.content || null
}
