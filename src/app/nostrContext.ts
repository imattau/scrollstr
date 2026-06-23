import { createContext } from 'react'
import type { EventStore } from 'applesauce-core'
import type { SimplePool } from 'nostr-tools'

export interface UserSession {
  pubkey: string
  method: 'nip07' | 'nip46' | 'readonly' | 'passkey'
  signer?: any // PasskeySigner, or window.nostr (NIP-07)
}

export interface NostrContextProps {
  /** @deprecated use pool instead */
  rxNostr: SimplePool
  pool: SimplePool
  eventStore: EventStore
  isConnected: boolean
  session: UserSession | null
  loginWithNip07: () => Promise<string>
  loginReadOnly: (pubkey: string) => void
  loginWithPasskey: () => Promise<string>
  registerPasskey: (nsec?: string) => Promise<string>
  logout: () => void
  signEvent: (eventTemplate: any) => Promise<any>
}

export const NostrContext = createContext<NostrContextProps | undefined>(undefined)
