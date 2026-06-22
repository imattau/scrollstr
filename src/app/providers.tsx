import React, { createContext, useContext, useEffect, useState } from 'react'
import NDK, { NDKNip07Signer, NDKUser } from '@nostr-dev-kit/ndk'
import { ndk, initNdk } from '../nostr/ndk'

interface UserSession {
  pubkey: string
  method: 'nip07' | 'nip46' | 'readonly'
  user: NDKUser
}

interface NostrContextProps {
  ndk: NDK
  isConnected: boolean
  session: UserSession | null
  loginWithNip07: () => Promise<string>
  loginReadOnly: (pubkey: string) => void
  logout: () => void
}

const NostrContext = createContext<NostrContextProps | undefined>(undefined)

export const useNostr = () => {
  const context = useContext(NostrContext)
  if (!context) {
    throw new Error('useNostr must be used within a NostrProvider')
  }
  return context
}

export const NostrProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false)
  const [session, setSession] = useState<UserSession | null>(null)

  useEffect(() => {
    let active = true

    const connect = async () => {
      await initNdk()
      if (active) {
        setIsConnected(true)
      }
    }

    connect()

    return () => {
      active = false
    }
  }, [])

  const loginWithNip07 = async (): Promise<string> => {
    if (!window.nostr) {
      throw new Error('NIP-07 Extension not found')
    }
    const signer = new NDKNip07Signer()
    ndk.signer = signer
    const user = await signer.user()
    setSession({
      pubkey: user.pubkey,
      method: 'nip07',
      user,
    })
    return user.pubkey
  }

  const loginReadOnly = (npubOrPubkey: string) => {
    let pubkey = npubOrPubkey
    // Resolve npub if needed (for simplicity, assuming user enters pubkey or npub resolved elsewhere)
    const user = ndk.getUser({ pubkey })
    setSession({
      pubkey,
      method: 'readonly',
      user,
    })
  }

  const logout = () => {
    ndk.signer = undefined
    setSession(null)
  }

  return (
    <NostrContext.Provider
      value={{
        ndk,
        isConnected,
        session,
        loginWithNip07,
        loginReadOnly,
        logout,
      }}
    >
      {children}
    </NostrContext.Provider>
  )
}
