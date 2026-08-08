import { invoke } from '@tauri-apps/api/core'

export interface KeyResult {
  pubkey: string
  npub: string
}

export async function generateKey(): Promise<KeyResult> {
  return invoke<KeyResult>('nostr_generate_key')
}

export async function importKey(nsecOrHex: string): Promise<KeyResult> {
  return invoke<KeyResult>('nostr_import_key', { nsecOrHex })
}

export async function signEvent(template: string): Promise<string> {
  return invoke<string>('nostr_sign_event', { template })
}

export async function getPubkey(): Promise<KeyResult> {
  return invoke<KeyResult>('nostr_get_pubkey')
}

export async function hasKey(): Promise<boolean> {
  return invoke<boolean>('nostr_has_key')
}

export async function removeKey(): Promise<void> {
  return invoke('nostr_remove_key')
}
