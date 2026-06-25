import React, { useContext, useEffect, useState } from 'react'
import { pool } from '../nostr/pool'
import { startCacheBackfill } from '../nostr/cacheBackfill'
import {
  readStoredPasskeyIdentity,
  unlockPasskeyIdentity,
  registerPasskeyIdentity,
  importPasskeyIdentityFromNsec,
  clearPasskeyIdentity
} from 'nostr-passkey'
import { PasskeySigner } from 'nostr-passkey/applesauce'
import { NostrContext, type UserSession } from './nostrContext'
import { NostrConnectSigner } from '../nostr/nip46'

export const useNostr = () => {
  const context = useContext(NostrContext)
  if (!context) {
    throw new Error('useNostr must be used within a NostrProvider')
  }
  return context
}

export const NostrProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(true) // pool is always active
  const [session, setSession] = useState<UserSession | null>(null)

  // On mount, start cache backfill and restore session from localStorage
  useEffect(() => {
    void startCacheBackfill()

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
        } else if (method === 'nip46') {
          const { bunkerUrl } = JSON.parse(stored)
          if (bunkerUrl) {
            NostrConnectSigner.fromBunkerURI(bunkerUrl)
              .then(async (signer) => {
                const connectedPubkey = await signer.connect()
                setSession({ pubkey: connectedPubkey, method: 'nip46', signer })
              })
              .catch((err) => {
                console.warn('[NIP-46] Reconnect failed for restored session:', err)
                setSession({ pubkey, method: 'nip46', signer: null })
              })
          } else {
            setSession({ pubkey, method: 'nip46', signer: null })
          }
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

  const loginWithNip46 = async (bunkerUrl: string): Promise<string> => {
    const signer = await NostrConnectSigner.fromBunkerURI(bunkerUrl)
    const pubkey = await signer.connect()

    const newSession: UserSession = {
      pubkey,
      method: 'nip46',
      signer,
    }
    setSession(newSession)
    localStorage.setItem(
      'scrollstr_session',
      JSON.stringify({ pubkey, method: 'nip46', bunkerUrl })
    )
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

  const registerPasskey = async (nsec?: string): Promise<string> => {
    console.log(nsec ? 'Registering passkey from existing nsec...' : 'Registering new passkey identity...')
    const options = {
      rpName: 'Scrollstr',
      userName: 'scrollstr_user_' + Math.floor(Math.random() * 1000000),
      displayName: 'Scrollstr User'
    }
    const result = nsec
      ? await importPasskeyIdentityFromNsec(nsec, options)
      : await registerPasskeyIdentity(options)
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
    } else if (session.method === 'nip46') {
      const remoteSigner = session.signer as NostrConnectSigner
      if (!remoteSigner || !remoteSigner.isConnected) {
        throw new Error('NIP-46 remote signer is not connected')
      }
      return await remoteSigner.signEvent(event)
    } else {
      throw new Error('Signing is not supported in read-only mode')
    }
  }

  return (
    <NostrContext.Provider
      value={{
        pool,
        isConnected,
        session,
        loginWithNip07,
        loginWithNip46,
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
