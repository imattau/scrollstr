import React, { createContext, useContext, useEffect, useState } from 'react'
import NDK from '@nostr-dev-kit/ndk'
import { ndk, initNdk } from '../nostr/ndk'

interface NostrContextProps {
  ndk: NDK
  isConnected: boolean
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

  return (
    <NostrContext.Provider value={{ ndk, isConnected }}>
      {children}
    </NostrContext.Provider>
  )
}
