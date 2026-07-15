import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { pool, cleanupPool } from '../nostr/pool'
import { startCacheBackfill, resetBackfillState } from '../nostr/cacheBackfill'
import { resetProfileBatch } from '../nostr/profile'
import { terminateFFmpeg } from '../features/post/convertVideo'
import { graph } from '../graph/polygraph'
import {
  readStoredPasskeyIdentity,
  unlockPasskeyIdentity,
  registerPasskeyIdentity,
  importPasskeyIdentityFromNsec,
  clearPasskeyIdentity
} from 'nostr-passkey'
import { PasskeySigner } from 'nostr-passkey/applesauce'
import { NostrContext, type UserSession } from './nostrContext'
import { NostrConnectSigner, parseBunkerUrl } from '../nostr/nip46'
import { loadSettings, saveSettings, mergeSettings } from '../db/local-preferences'
import { loadRawSettingsEvent, decryptSettingsJson, getNip44, getNip44FromSigner } from '../nostr/events/settings'

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
          const parsed = JSON.parse(stored)
          const relayUrl = parsed.relayUrl || parsed.bunkerUrl
          const signerPubkey = parsed.signerPubkey || pubkey
          if (relayUrl && signerPubkey) {
            // Reconstruct bunker URI without the secret (intentionally omitted on save)
            const reconnectUri = `bunker://${signerPubkey}?relay=${encodeURIComponent(relayUrl)}`
            NostrConnectSigner.fromBunkerURI(reconnectUri)
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

  // Try to sync app settings from Nostr kind-30078 event
  useEffect(() => {
    if (!session || session.method === 'readonly') return

    const trySync = async () => {
      const nip44 = getNip44() ?? (session.signer ? getNip44FromSigner(session.signer) : null)
      if (!nip44) return

      const encrypted = await loadRawSettingsEvent(session.pubkey)
      if (!encrypted) return

      const decrypted = await decryptSettingsJson(nip44, session.pubkey, encrypted)
      if (!decrypted) return

      const current = loadSettings()
      const merged = mergeSettings(current, decrypted)
      saveSettings(merged)
      console.log('[settings] Synced settings from Nostr kind-30078')
    }

    trySync().catch((err) => console.warn('[settings] Failed to sync from Nostr:', err))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.pubkey, session?.method])

  const loginWithNip07 = useCallback(async (): Promise<string> => {
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
  }, [])

  const loginWithNip46 = useCallback(async (bunkerUrl: string): Promise<string> => {
    const signer = await NostrConnectSigner.fromBunkerURI(bunkerUrl)
    const pubkey = await signer.connect()

    const newSession: UserSession = {
      pubkey,
      method: 'nip46',
      signer,
    }
    setSession(newSession)
    // Store only the relay URL and signer pubkey — omit the secret to limit exposure
    const parsed = parseBunkerUrl(bunkerUrl)
    localStorage.setItem(
      'scrollstr_session',
      JSON.stringify({ pubkey, method: 'nip46', relayUrl: parsed.relayUrl, signerPubkey: parsed.signerPubkey })
    )
    return pubkey
  }, [])

  const loginReadOnly = useCallback((npubOrPubkey: string) => {
    let pubkey = npubOrPubkey
    // Try decoding npub (bech32) to hex; fall back to raw hex string
    if (pubkey.startsWith('npub1')) {
      try {
        const decoded = nip19.decode(pubkey)
        pubkey = decoded.data as string
      } catch {
        console.warn('Invalid npub format, using as-is:', pubkey)
      }
    } else if (!/^[0-9a-f]{64}$/i.test(pubkey)) {
      console.warn('Invalid pubkey format (expected 64-char hex or npub1...):', pubkey)
    }
    const newSession: UserSession = {
      pubkey,
      method: 'readonly',
    }
    setSession(newSession)
    localStorage.setItem('scrollstr_session', JSON.stringify({ pubkey, method: 'readonly' }))
  }, [])

  const loginWithPasskey = useCallback(async (): Promise<string> => {
    const record = readStoredPasskeyIdentity()
    if (!record) {
      throw new Error('No passkey identity found on this device. Please register first.')
    }
    console.log('Unlocking passkey identity for login...')
    const result = await unlockPasskeyIdentity(record)
    const signer = new PasskeySigner(result.record, { key: result.secretKey })
    const pubkey = result.pubkey
    setSession({
      pubkey,
      method: 'passkey',
      signer,
    })
    localStorage.setItem('scrollstr_session', JSON.stringify({ pubkey, method: 'passkey' }))
    return pubkey
  }, [])

  const registerPasskey = useCallback(async (nsec?: string): Promise<string> => {
    console.log(nsec ? 'Registering passkey from existing nsec...' : 'Registering new passkey identity...')
    const options = {
      rpName: 'Nostr Clips',
      userName: 'nostrclips_user_' + Math.floor(Math.random() * 1000000),
      displayName: 'Nostr Clips User'
    }
    const result = nsec
      ? await importPasskeyIdentityFromNsec(nsec, options)
      : await registerPasskeyIdentity(options)
    const signer = new PasskeySigner(result.record, { key: result.secretKey })
    const pubkey = result.pubkey
    setSession({
      pubkey,
      method: 'passkey',
      signer,
    })
    localStorage.setItem('scrollstr_session', JSON.stringify({ pubkey, method: 'passkey' }))
    return pubkey
  }, [])

  const logout = useCallback(() => {
    // NIP-46: close the remote signer's relay subscriptions.
    if (session?.method === 'nip46' && session.signer && typeof (session.signer as any).close === 'function') {
      void (session.signer as any).close().catch((err: unknown) =>
        console.warn('[logout] NIP-46 signer close failed:', err)
      )
    }
    clearPasskeyIdentity()
    setSession(null)
    localStorage.removeItem('scrollstr_session')
    // Reset module-level state BEFORE terminating the worker.
    resetBackfillState()
    resetProfileBatch()
    terminateFFmpeg()
    void graph.dispose().catch((err: unknown) =>
      console.warn('[logout] graph.dispose failed:', err)
    )
    cleanupPool()
  }, [session])

  const signEvent = useCallback(async (eventTemplate: any): Promise<any> => {
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
        activeSigner = new PasskeySigner(result.record, { key: result.secretKey })
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
  }, [session])

  const contextValue = useMemo(() => ({
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
  }), [isConnected, session, loginWithNip07, loginWithNip46, loginReadOnly, loginWithPasskey, registerPasskey, logout, signEvent])

  return (
    <NostrContext.Provider value={contextValue}>
      {children}
    </NostrContext.Provider>
  )
}
