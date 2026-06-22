import React, { useState } from 'react'
import { X, Key, ShieldCheck, UserCheck, Eye } from 'lucide-react'

interface LoginSheetProps {
  isOpen: boolean
  onClose: () => void
  onLoginSuccess: (method: string, data?: string) => void
}

export const LoginSheet: React.FC<LoginSheetProps> = ({ isOpen, onClose, onLoginSuccess }) => {
  const [npub, setNpub] = useState('')
  const [nip46Address, setNip46Address] = useState('')
  const [error, setError] = useState('')

  if (!isOpen) return null

  const handleNip07Login = async () => {
    setError('')
    if (window.nostr) {
      try {
        const pubkey = await window.nostr.getPublicKey()
        onLoginSuccess('nip07', pubkey)
      } catch (err: any) {
        setError(err.message || 'NIP-07 Login cancelled')
      }
    } else {
      setError('NIP-07 extension (like Alby/Nos2x) not detected. Install it or try another method.')
    }
  }

  const handleNip46Login = () => {
    setError('')
    if (!nip46Address.trim()) {
      setError('Please enter a remote signer address / bunker connection')
      return
    }
    onLoginSuccess('nip46', nip46Address)
  }

  const handleReadOnlyLogin = () => {
    setError('')
    if (!npub.startsWith('npub1') || npub.length < 10) {
      setError('Please enter a valid npub key starting with npub1')
      return
    }
    onLoginSuccess('readonly', npub)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-neutral-400 hover:text-white transition-colors"
        >
          <X className="w-6 h-6" />
        </button>

        {/* Title */}
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
            Join Nostr Clips
          </h2>
          <p className="text-xs text-neutral-400 mt-1">
            Authorize to like, comment, boost, zap or upload clips.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-center">
            {error}
          </div>
        )}

        <div className="space-y-4">
          
          {/* Method 1: NIP-07 Browser Extension */}
          <button
            onClick={handleNip07Login}
            className="w-full flex items-center gap-3 px-4 py-3 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-xl transition-all duration-200 shadow-lg shadow-purple-600/20"
          >
            <ShieldCheck className="w-5 h-5 shrink-0" />
            <div className="text-left">
              <div className="text-sm font-semibold">NIP-07 Extension</div>
              <div className="text-[10px] opacity-80">Login via Alby, Nos2x, etc.</div>
            </div>
          </button>

          <div className="relative flex py-2 items-center">
            <div className="flex-grow border-t border-neutral-800"></div>
            <span className="flex-shrink mx-4 text-neutral-500 text-[10px] uppercase tracking-wider font-bold">Or use keys</span>
            <div className="flex-grow border-t border-neutral-800"></div>
          </div>

          {/* Method 2: NIP-46 Remote Signer */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">
              NIP-46 Remote Signer / Bunker
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={nip46Address}
                onChange={(e) => setNip46Address(e.target.value)}
                placeholder="name@bunker.com or bunker://..."
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-purple-500"
              />
              <button
                onClick={handleNip46Login}
                className="bg-neutral-800 hover:bg-neutral-700 px-4 rounded-xl text-xs font-semibold text-white transition-colors"
              >
                Connect
              </button>
            </div>
          </div>

          {/* Method 3: Read-only npub */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">
              Read-Only npub
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={npub}
                onChange={(e) => setNpub(e.target.value)}
                placeholder="npub1..."
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-purple-500"
              />
              <button
                onClick={handleReadOnlyLogin}
                className="bg-neutral-800 hover:bg-neutral-700 px-4 rounded-xl text-xs font-semibold text-white transition-colors"
              >
                Watch
              </button>
            </div>
          </div>

          <div className="pt-2 text-center">
            <button
              onClick={onClose}
              className="text-[11px] text-neutral-400 hover:text-white hover:underline transition-colors"
            >
              Continue browsing in Guest Mode
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

declare global {
  interface Window {
    nostr?: {
      getPublicKey: () => Promise<string>
      signEvent: (event: any) => Promise<any>
    }
  }
}
