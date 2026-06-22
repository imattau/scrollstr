import React, { useState } from 'react'
import { Server, Compass, Wallet, Shield, Video, Flame } from 'lucide-react'

export const SettingsPage: React.FC = () => {
  const [relays, setRelays] = useState('wss://nos.lol, wss://relay.damus.io, wss://relay.snort.social')
  const [blossomServers, setBlossomServers] = useState('https://blossom.damus.io, https://media.nostr.band')
  const [walletString, setWalletString] = useState('')
  const [autoplay, setAutoplay] = useState(true)

  return (
    <div className="p-4 space-y-6">
      <h2 className="text-xl font-bold pb-2 border-b border-neutral-900">Settings</h2>

      <div className="space-y-4 divide-y divide-neutral-900">
        
        {/* Section 1: Nostr Relays */}
        <div className="space-y-2 pt-2">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-purple-400" />
            <h3 className="text-xs font-bold text-neutral-350 uppercase tracking-wider">Read/Write Relays</h3>
          </div>
          <p className="text-[10px] text-neutral-500">Comma separated list of bootstrap relays</p>
          <input
            type="text"
            value={relays}
            onChange={(e) => setRelays(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-purple-500"
          />
        </div>

        {/* Section 2: Blossom Servers */}
        <div className="space-y-2 pt-4">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-400" />
            <h3 className="text-xs font-bold text-neutral-350 uppercase tracking-wider">Blossom Media Servers</h3>
          </div>
          <p className="text-[10px] text-neutral-500">Blossom servers for redundancy uploads</p>
          <input
            type="text"
            value={blossomServers}
            onChange={(e) => setBlossomServers(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-purple-500"
          />
        </div>

        {/* Section 3: Lightning Wallet */}
        <div className="space-y-2 pt-4">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-yellow-450" />
            <h3 className="text-xs font-bold text-neutral-350 uppercase tracking-wider">NWC / WebLN Connect</h3>
          </div>
          <p className="text-[10px] text-neutral-500">Nostr Wallet Connect string (secret)</p>
          <input
            type="password"
            value={walletString}
            onChange={(e) => setWalletString(e.target.value)}
            placeholder="nostr+walletconnect://..."
            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-250 focus:outline-none focus:border-purple-500"
          />
        </div>

        {/* Section 4: Video Settings */}
        <div className="flex justify-between items-center pt-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Video className="w-4 h-4 text-green-400" />
              <h3 className="text-xs font-bold text-neutral-350 uppercase tracking-wider">Autoplay video</h3>
            </div>
            <p className="text-[10px] text-neutral-500">Automatically play the next video in viewport</p>
          </div>
          <input
            type="checkbox"
            checked={autoplay}
            onChange={(e) => setAutoplay(e.target.checked)}
            className="w-4 h-4 rounded border-neutral-800 bg-neutral-900 text-purple-600 focus:ring-purple-500"
          />
        </div>

        {/* Section 5: Cache */}
        <div className="pt-4 space-y-2">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-400" />
            <h3 className="text-xs font-bold text-neutral-350 uppercase tracking-wider">Identity & Signers</h3>
          </div>
          <p className="text-[10px] text-neutral-500">Clear key storage and local preferences</p>
          <button className="px-4 py-2 bg-red-950 border border-red-800 text-red-400 text-xs font-semibold rounded-xl hover:bg-red-900/40 transition-colors">
            Reset Identity Cache
          </button>
        </div>
      </div>
    </div>
  )
}
