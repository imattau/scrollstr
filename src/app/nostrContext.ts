import { createContext } from 'react'
import type { SimplePool } from 'nostr-tools'

export interface UserSession {
  pubkey: string
  method: 'nip07' | 'nip46' | 'readonly' | 'passkey' | 'native'
  signer?: any // PasskeySigner, TauriNativeSigner, or window.nostr (NIP-07)
}

export interface NostrContextProps {
  pool: SimplePool
  isConnected: boolean
  session: UserSession | null
  loginWithNip07: () => Promise<string>
  loginWithNip46: (bunkerUrl: string) => Promise<string>
  loginReadOnly: (npubOrPubkey: string) => void
  loginWithPasskey: () => Promise<string>
  registerPasskey: (nsec?: string) => Promise<string>
  loginWithNative: () => Promise<string>
  registerNative: (nsec?: string) => Promise<string>
  logout: () => void
  signEvent: (eventTemplate: any) => Promise<any>
}

export const NostrContext = createContext<NostrContextProps | undefined>(undefined)
