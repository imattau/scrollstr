import React, { createContext, useContext, useEffect, useState } from 'react'
import { RxNostr } from 'rx-nostr'
import { EventStore } from 'applesauce-core'
import { rxNostr, eventStore } from '../nostr/rxNostr'
import { loadCachedEvents } from '../nostr/cache'
import {
  readStoredPasskeyIdentity,
  hasStoredPasskeyIdentity,
  unlockPasskeyIdentity,
  registerPasskeyIdentity,
  clearPasskeyIdentity
} from 'nostr-passkey'
import { PasskeySigner } from 'nostr-passkey/applesauce'

export interface UserSession {
  pubkey: string
  method: 'nip07' | 'nip46' | 'readonly' | 'passkey'
  signer?: any // PasskeySigner, or window.nostr (NIP-07)
}

interface NostrContextProps {
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

const NostrContext = createContext<NostrContextProps | undefined>(undefined)

export const useNostr = () => {
  const context = useContext(NostrContext)
  if (!context) {
    throw new Error('useNostr must be used within a NostrProvider')
  }
  return context
}

declare global {
  interface Window {
    nostr?: {
      getPublicKey: () => Promise<string>
      signEvent: (event: any) => Promise<any>
    }
  }
}

export const NostrProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(true) // rx-nostr is always active
  const [session, setSession] = useState<UserSession | null>(null)

  // On mount, restore session from localStorage if present and load IndexedDB cached events
  useEffect(() => {
    // Load local cached events into Applesauce EventStore
    loadCachedEvents(eventStore)

    const stored = localStorage.getItem('scrollstr_session')
    if (stored) {
      try {
        const { pubkey, method } = JSON.parse(stored)
        if (method === 'readonly') {
          setSession({ pubkey, method })
        } else if (method === 'nip07') {
          setSession({ pubkey, method })
        } else if (method === 'passkey') {
          setSession({ pubkey, method, signer: null })
        }
      } catch (e) {
        console.error('Failed to restore session:', e)
      }
    }
  }, [])

  const loginWithNip07 = async (): Promise<string> => {
    if (!window.nostr) {
      throw new Error('NIP-07 Extension not found')
    }
    const pubkey = await window.nostr.getPublicKey()
    const newSession: UserSession = {
      pubkey,
      method: 'nip07',
    }
    setSession(newSession)
    localStorage.setItem('scrollstr_session', JSON.stringify({ pubkey, method: 'nip07' }))
    return pubkey
  }

  const loginReadOnly = (npubOrPubkey: string) => {
    const pubkey = npubOrPubkey
    // If it's npub, we could decode it, but assuming it's resolved or raw hex here.
    // For simplicity, if npub, let's keep it as is or handle it
    const newSession: UserSession = {
      pubkey,
      method: 'readonly',
    }
    setSession(newSession)
    localStorage.setItem('scrollstr_session', JSON.stringify({ pubkey, method: 'readonly' }))
  }

  const loginWithPasskey = async (): Promise<string> => {
    const record = readStoredPasskeyIdentity()
    if (!record) {
      throw new Error('No passkey identity found on this device. Please register first.')
    }
    console.log('Unlocking passkey identity for login...')
    const result = await unlockPasskeyIdentity(record)
    const signer = new PasskeySigner(result.record, result.secretKey)
    const pubkey = result.pubkey
    setSession({
      pubkey,
      method: 'passkey',
      signer,
    })
    localStorage.setItem('scrollstr_session', JSON.stringify({ pubkey, method: 'passkey' }))
    return pubkey
  }

  const registerPasskey = async (): Promise<string> => {
    console.log('Registering new passkey identity...')
    const result = await registerPasskeyIdentity({
      rpName: 'Scrollstr',
      userName: 'scrollstr_user_' + Math.floor(Math.random() * 1000000),
      displayName: 'Scrollstr User'
    })
    const signer = new PasskeySigner(result.record, result.secretKey)
    const pubkey = result.pubkey
    setSession({
      pubkey,
      method: 'passkey',
      signer,
    })
    localStorage.setItem('scrollstr_session', JSON.stringify({ pubkey, method: 'passkey' }))
    return pubkey
  }

  const logout = () => {
    clearPasskeyIdentity()
    setSession(null)
    localStorage.removeItem('scrollstr_session')
  }

  const signEvent = async (eventTemplate: any): Promise<any> => {
    if (!session) throw new Error('No active Nostr session')
    
    const event = {
      ...eventTemplate,
      pubkey: session.pubkey,
      created_at: eventTemplate.created_at || Math.floor(Date.now() / 1000),
      tags: eventTemplate.tags || [],
      content: eventTemplate.content || '',
    }

    if (session.method === 'nip07') {
      if (!window.nostr) throw new Error('NIP-07 extension not found')
      return await window.nostr.signEvent(event)
    } else if (session.method === 'passkey') {
      let activeSigner = session.signer
      if (!activeSigner) {
        console.log('Passkey signer locked, unlocking...')
        const record = readStoredPasskeyIdentity()
        if (!record) throw new Error('No passkey identity record found on device')
        const result = await unlockPasskeyIdentity(record)
        activeSigner = new PasskeySigner(result.record, result.secretKey)
        setSession({
          pubkey: session.pubkey,
          method: 'passkey',
          signer: activeSigner,
        })
      }
      return await activeSigner.signEvent(event)
    } else {
      throw new Error('Signing is not supported in read-only mode')
    }
  }

  return (
    <NostrContext.Provider
      value={{
        rxNostr,
        eventStore,
        isConnected,
        session,
        loginWithNip07,
        loginReadOnly,
        loginWithPasskey,
        registerPasskey,
        logout,
        signEvent,
      }}
    >
      {children}
    </NostrContext.Provider>
  )
}
