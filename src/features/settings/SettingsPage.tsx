import React, { useState, useEffect } from 'react'
import { Server, Wallet, Shield, Video, Flame } from 'lucide-react'
import { loadSettings, saveSettings, AppSettings } from '../../db/local-preferences'

export const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(loadSettings())
  const [relaysInput, setRelaysInput] = useState('')
  const [blossomInput, setBlossomInput] = useState('')
  const [walletInput, setWalletInput] = useState('')
  const [autoplayInput, setAutoplayInput] = useState(true)

  // Initialize fields
  useEffect(() => {
    setRelaysInput(settings.relays.join(', '))
    setBlossomInput(settings.blossomServers.join(', '))
    setWalletInput(settings.walletString)
    setAutoplayInput(settings.autoplay)
  }, [settings])

  const handleSave = () => {
    const updated: AppSettings = {
      relays: relaysInput.split(',').map((r) => r.trim()).filter((r) => r.length > 0),
      blossomServers: blossomInput.split(',').map((b) => b.trim()).filter((b) => b.length > 0),
      walletString: walletInput.trim(),
      autoplay: autoplayInput,
      mutedUsers: settings.mutedUsers,
    }
    saveSettings(updated)
    setSettings(updated)
    alert('Settings saved successfully!')
  }

  const handleResetCache = () => {
    if (confirm('Are you sure you want to reset setting configuration? This will reload defaults.')) {
      localStorage.removeItem('nostr-clips-settings')
      setSettings(loadSettings())
      alert('Settings configuration reset completed.')
    }
  }

  return (
    <div className="p-4 space-y-6">
      <div className="flex justify-between items-center pb-2 border-b border-neutral-900">
        <h2 className="text-xl font-bold">Settings</h2>
        <button
          onClick={handleSave}
          className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs rounded-xl transition-colors shadow-lg shadow-purple-600/20"
        >
          Save Changes
        </button>
      </div>

      <div className="space-y-4 divide-y divide-neutral-900">
        
        {/* Relays */}
        <div className="space-y-2 pt-2">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-purple-400" />
            <h3 className="text-xs font-bold text-neutral-350 uppercase tracking-wider">Read/Write Relays</h3>
          </div>
          <p className="text-[10px] text-neutral-500">Bootstrap Nostr relays list (comma-separated)</p>
          <input
            type="text"
            value={relaysInput}
            onChange={(e) => setRelaysInput(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-purple-500"
          />
        </div>

        {/* Blossom */}
        <div className="space-y-2 pt-4">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-400" />
            <h3 className="text-xs font-bold text-neutral-350 uppercase tracking-wider">Blossom Media Servers</h3>
          </div>
          <p className="text-[10px] text-neutral-500">Blossom host URLs for redundantly uploading clips</p>
          <input
            type="text"
            value={blossomInput}
            onChange={(e) => setBlossomInput(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-purple-500"
          />
        </div>

        {/* Wallet */}
        <div className="space-y-2 pt-4">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-yellow-450" />
            <h3 className="text-xs font-bold text-neutral-350 uppercase tracking-wider">NWC / WebLN Wallet</h3>
          </div>
          <p className="text-[10px] text-neutral-500">Nostr Wallet Connect string (stored locally)</p>
          <input
            type="password"
            value={walletInput}
            onChange={(e) => setWalletInput(e.target.value)}
            placeholder="nostr+walletconnect://..."
            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-250 focus:outline-none focus:border-purple-500"
          />
        </div>

        {/* Autoplay toggle */}
        <div className="flex justify-between items-center pt-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Video className="w-4 h-4 text-green-400" />
              <h3 className="text-xs font-bold text-neutral-350 uppercase tracking-wider">Autoplay feed</h3>
            </div>
            <p className="text-[10px] text-neutral-500">Automatically play clips in focus when scrolling</p>
          </div>
          <input
            type="checkbox"
            checked={autoplayInput}
            onChange={(e) => setAutoplayInput(e.target.checked)}
            className="w-4 h-4 rounded border-neutral-800 bg-neutral-900 text-purple-650 focus:ring-purple-500 cursor-pointer"
          />
        </div>

        {/* Reset Cache */}
        <div className="pt-4 space-y-2">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-400" />
            <h3 className="text-xs font-bold text-neutral-350 uppercase tracking-wider">Identity & Settings</h3>
          </div>
          <p className="text-[10px] text-neutral-500">Clear key storage, mutes list and configuration</p>
          <button
            onClick={handleResetCache}
            className="px-4 py-2 bg-red-950 border border-red-800 text-red-400 text-xs font-semibold rounded-xl hover:bg-red-900/40 transition-colors"
          >
            Reset Client Cache
          </button>
        </div>
      </div>
    </div>
  )
}
