import { createContext } from 'react'
import type { EventStore } from 'applesauce-core'
import type { RxNostr } from 'rx-nostr'

export interface UserSession {
  pubkey: string
  method: 'nip07' | 'nip46' | 'readonly' | 'passkey'
  signer?: any // PasskeySigner, or window.nostr (NIP-07)
}

export interface NostrContextProps {
  rxNostr: RxNostr
  eventStore: EventStore
  isConnected: boolean
  session: UserSession | null
  loginWithNip07: () => Promise<string>
  loginReadOnly: (pubkey: string) => void
  loginWithPasskey: () => Promise<string>
  registerPasskey: () => Promise<string>
  logout: () => void
  signEvent: (eventTemplate: any) => Promise<any>
}

export const NostrContext = createContext<NostrContextProps | undefined>(undefined)
