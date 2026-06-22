import React, { useState, useEffect, useMemo } from 'react'
import { useNostr } from '../../app/providers'
import { getEventsQuery$ } from '../../nostr/rxNostr'
import { use$ } from 'applesauce-react/hooks'
import { createRxForwardReq } from 'rx-nostr'
import { ArrowLeft, Plus, Trash2, Key, Wallet, Copy, LogOut, UploadCloud } from 'lucide-react'
import { publishRelayList, publishBlossomList, publishMuteList, publishNip96List } from '../../nostr/events/settings'
import { loadSettings, saveSettings } from '../../db/local-preferences'

export const SettingsPage: React.FC = () => {
  const { session, rxNostr, signEvent, eventStore, logout } = useNostr()
  const userPubkey = session?.pubkey

  const [activeSubView, setActiveSubView] = useState<'main' | 'relays' | 'blossom' | 'nip96' | 'mute' | 'identity' | 'wallet'>('main')
  const [saving, setSaving] = useState(false)

  // Local state overrides for draft editing before publishing
  const [localRelays, setLocalRelays] = useState<{ url: string; read: boolean; write: boolean }[]>([])
  const [localBlossom, setLocalBlossom] = useState<string[]>([])
  const [localNip96, setLocalNip96] = useState<string[]>([])
  const [localMutePubkeys, setLocalMutePubkeys] = useState<string[]>([])
  const [localMuteTags, setLocalMuteTags] = useState<string[]>([])
  const [localWalletString, setLocalWalletString] = useState('')

  // Input states for adding new entries
  const [newRelayUrl, setNewRelayUrl] = useState('')
  const [newRelayRead, setNewRelayRead] = useState(true)
  const [newRelayWrite, setNewRelayWrite] = useState(true)
  const [newBlossomUrl, setNewBlossomUrl] = useState('')
  const [newNip96Url, setNewNip96Url] = useState('')
  const [newMutePubkey, setNewMutePubkey] = useState('')
  const [newMuteTag, setNewMuteTag] = useState('')

  // Query events in EventStore
  const relayListEvent = use$(() => getEventsQuery$({ kinds: [10002], authors: userPubkey ? [userPubkey] : [] }), [userPubkey])?.[0]
  const blossomListEvent = use$(() => getEventsQuery$({ kinds: [10063], authors: userPubkey ? [userPubkey] : [] }), [userPubkey])?.[0]
  const nip96ListEvent = use$(() => getEventsQuery$({ kinds: [10096], authors: userPubkey ? [userPubkey] : [] }), [userPubkey])?.[0]
  const muteListEvent = use$(() => getEventsQuery$({ kinds: [10000], authors: userPubkey ? [userPubkey] : [] }), [userPubkey])?.[0]

  // Subscribe to real-time events on mount if logged in
  useEffect(() => {
    if (!userPubkey) return
    console.log(`Subscribing to Nostr lists for pubkey ${userPubkey}...`)
    const rxReq = createRxForwardReq()
    const sub = rxNostr.use(rxReq).subscribe()
    rxReq.emit({ kinds: [10000, 10002, 10063, 10096], authors: [userPubkey], limit: 10 })
    return () => {
      sub.unsubscribe()
    }
  }, [rxNostr, userPubkey])

  // Load wallet string and synchronize local states when store events update
  useEffect(() => {
    const s = loadSettings()
    setLocalWalletString(s.walletString || '')
  }, [activeSubView])

  useEffect(() => {
    if (relayListEvent) {
      const parsed = relayListEvent.tags
        .filter((t: any) => t[0] === 'r')
        .map((t: any) => {
          const url = t[1]
          const type = t[2]
          return {
            url,
            read: !type || type === 'read',
            write: !type || type === 'write',
          }
        })
      setLocalRelays(parsed)
    } else {
      setLocalRelays([
        { url: 'wss://nos.lol', read: true, write: true },
        { url: 'wss://relay.damus.io', read: true, write: true },
        { url: 'wss://relay.snort.social', read: true, write: true },
      ])
    }
  }, [relayListEvent])

  useEffect(() => {
    if (blossomListEvent) {
      const parsed = blossomListEvent.tags
        .filter((t: any) => t[0] === 'server' || t[0] === 'r')
        .map((t: any) => t[1])
      setLocalBlossom(parsed)
    } else {
      setLocalBlossom(['https://cdn.nostr.build', 'https://void.cat'])
    }
  }, [blossomListEvent])

  useEffect(() => {
    if (nip96ListEvent) {
      const parsed = nip96ListEvent.tags
        .filter((t: any) => t[0] === 'server' || t[0] === 'r')
        .map((t: any) => t[1])
      setLocalNip96(parsed)
    } else {
      setLocalNip96(['https://nostr.build', 'https://void.cat'])
    }
  }, [nip96ListEvent])

  useEffect(() => {
    if (muteListEvent) {
      const pubkeys = muteListEvent.tags.filter((t: any) => t[0] === 'p').map((t: any) => t[1])
      const tags = muteListEvent.tags.filter((t: any) => t[0] === 't').map((t: any) => t[1])
      setLocalMutePubkeys(pubkeys)
      setLocalMuteTags(tags)
    } else {
      setLocalMutePubkeys([])
      setLocalMuteTags([])
    }
  }, [muteListEvent])

  // Handlers for Relays
  const handleAddRelay = () => {
    if (!newRelayUrl.trim()) return
    const formattedUrl = newRelayUrl.trim().startsWith('ws') ? newRelayUrl.trim() : `wss://${newRelayUrl.trim()}`
    if (localRelays.some((r) => r.url === formattedUrl)) {
      alert('Relay already in list')
      return
    }
    setLocalRelays([...localRelays, { url: formattedUrl, read: newRelayRead, write: newRelayWrite }])
    setNewRelayUrl('')
  }

  const handleRemoveRelay = (url: string) => {
    setLocalRelays(localRelays.filter((r) => r.url !== url))
  }

  const handleSaveRelays = async () => {
    if (!session) return
    setSaving(true)
    try {
      const ev = await publishRelayList(signEvent, rxNostr, localRelays)
      eventStore.add(ev)
      alert('Relay list published to relays!')
    } catch (e) {
      console.error(e)
      alert('Failed to publish: ' + e)
    } finally {
      setSaving(false)
    }
  }

  // Handlers for Blossom
  const handleAddBlossom = () => {
    if (!newBlossomUrl.trim()) return
    const formattedUrl = newBlossomUrl.trim().startsWith('http') ? newBlossomUrl.trim() : `https://${newBlossomUrl.trim()}`
    if (localBlossom.includes(formattedUrl)) {
      alert('Server already in list')
      return
    }
    setLocalBlossom([...localBlossom, formattedUrl])
    setNewBlossomUrl('')
  }

  const handleRemoveBlossom = (url: string) => {
    setLocalBlossom(localBlossom.filter((s) => s !== url))
  }

  const handleSaveBlossom = async () => {
    if (!session) return
    setSaving(true)
    try {
      const ev = await publishBlossomList(signEvent, rxNostr, localBlossom)
      eventStore.add(ev)
      alert('Blossom media servers published!')
    } catch (e) {
      console.error(e)
      alert('Failed to publish: ' + e)
    } finally {
      setSaving(false)
    }
  }

  // Handlers for NIP-96
  const handleAddNip96 = () => {
    if (!newNip96Url.trim()) return
    const formattedUrl = newNip96Url.trim().startsWith('http') ? newNip96Url.trim() : `https://${newNip96Url.trim()}`
    if (localNip96.includes(formattedUrl)) {
      alert('Server already in list')
      return
    }
    setLocalNip96([...localNip96, formattedUrl])
    setNewNip96Url('')
  }

  const handleRemoveNip96 = (url: string) => {
    setLocalNip96(localNip96.filter((s) => s !== url))
  }

  const handleSaveNip96 = async () => {
    if (!session) return
    setSaving(true)
    try {
      const ev = await publishNip96List(signEvent, rxNostr, localNip96)
      eventStore.add(ev)
      alert('NIP-96 media servers published!')
    } catch (e) {
      console.error(e)
      alert('Failed to publish: ' + e)
    } finally {
      setSaving(false)
    }
  }

  // Handlers for Mutes
  const handleAddMutePubkey = () => {
    if (!newMutePubkey.trim()) return
    const pk = newMutePubkey.trim()
    if (localMutePubkeys.includes(pk)) return
    setLocalMutePubkeys([...localMutePubkeys, pk])
    setNewMutePubkey('')
  }

  const handleAddMuteTag = () => {
    if (!newMuteTag.trim()) return
    const tag = newMuteTag.trim().toLowerCase()
    if (localMuteTags.includes(tag)) return
    setLocalMuteTags([...localMuteTags, tag])
    setNewMuteTag('')
  }

  const handleRemoveMutePubkey = (pk: string) => {
    setLocalMutePubkeys(localMutePubkeys.filter((p) => p !== pk))
  }

  const handleRemoveMuteTag = (tag: string) => {
    setLocalMuteTags(localMuteTags.filter((t) => t !== tag))
  }

  const handleSaveMutes = async () => {
    if (!session) return
    setSaving(true)
    try {
      const ev = await publishMuteList(signEvent, rxNostr, localMutePubkeys, localMuteTags)
      eventStore.add(ev)
      alert('Mute list successfully published!')
    } catch (e) {
      console.error(e)
      alert('Failed to publish: ' + e)
    } finally {
      setSaving(false)
    }
  }

  // Handlers for Wallet NWC Connection
  const handleSaveWallet = () => {
    const s = loadSettings()
    s.walletString = localWalletString.trim()
    saveSettings(s)
    alert('Wallet NWC connection settings updated!')
    setActiveSubView('main')
  }

  const handleCopyPubkey = async () => {
    if (userPubkey) {
      await navigator.clipboard.writeText(userPubkey)
      alert('Copied pubkey hex to clipboard!')
    }
  }

  if (!session) {
    return (
      <div className="flex min-h-full flex-col bg-[#09090b] px-4 pb-4 pt-4 text-[#f7f7f8] items-center justify-center">
        <p className="text-[14px] text-[#a1a1aa] mb-4">Please log in to manage your Nostr settings lists.</p>
      </div>
    )
  }

  // Render Sub-view layouts
  if (activeSubView === 'identity') {
    return (
      <div className="flex min-h-full flex-col bg-[#09090b] px-4 pb-6 pt-4 text-[#f7f7f8]">
        <button
          onClick={() => setActiveSubView('main')}
          className="flex items-center gap-2 text-[14px] font-semibold text-[#a78bfa] mb-6 hover:underline font-medium"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Settings
        </button>

        <h3 className="text-[18px] font-bold mb-1">Identity & Signer</h3>
        <p className="text-[11px] text-[#a1a1aa] mb-6">Manage your active Nostr keys and session details.</p>

        <div className="space-y-4 mb-6">
          <div className="bg-[#111115] p-4 rounded-xl border border-neutral-900 space-y-1">
            <p className="text-[11px] font-bold text-[#a1a1aa]">Logged In Public Key (Hex)</p>
            <div className="flex items-center justify-between gap-3 bg-[#18181d] px-3 py-2 rounded-lg text-[13px] text-[#f7f7f8]">
              <span className="font-mono truncate">{userPubkey}</span>
              <button onClick={handleCopyPubkey} className="text-[#a78bfa] hover:text-white p-1 shrink-0">
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="bg-[#111115] p-4 rounded-xl border border-neutral-900 space-y-1">
            <p className="text-[11px] font-bold text-[#a1a1aa]">Signing Method</p>
            <p className="text-[14px] text-[#f7f7f8] bg-[#18181d] px-3 py-2 rounded-lg font-medium">
              {session.method.toUpperCase()}
            </p>
          </div>
        </div>

        <button
          onClick={() => {
            logout()
            setActiveSubView('main')
          }}
          className="w-full flex items-center justify-center gap-2 bg-red-600/10 hover:bg-red-600/20 text-red-400 py-3 rounded-xl text-[13px] font-bold transition-colors"
        >
          <LogOut className="w-4 h-4" /> Log out Account
        </button>
      </div>
    )
  }

  if (activeSubView === 'wallet') {
    return (
      <div className="flex min-h-full flex-col bg-[#09090b] px-4 pb-6 pt-4 text-[#f7f7f8]">
        <button
          onClick={() => setActiveSubView('main')}
          className="flex items-center gap-2 text-[14px] font-semibold text-[#a78bfa] mb-6 hover:underline font-medium"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Settings
        </button>

        <h3 className="text-[18px] font-bold mb-1">Wallet Connection</h3>
        <p className="text-[11px] text-[#a1a1aa] mb-6">Configure a Nostr Wallet Connect (NWC) connection string for quick zapping.</p>

        <div className="bg-[#111115] p-4 rounded-xl border border-neutral-900 space-y-2 mb-6">
          <p className="text-[11px] font-bold text-[#a1a1aa]">NWC Connection URI</p>
          <textarea
            value={localWalletString}
            onChange={(e) => setLocalWalletString(e.target.value)}
            placeholder="nostr+walletconnect://..."
            rows={4}
            className="w-full bg-[#18181d] p-3 rounded-lg text-[13px] outline-none text-[#f7f7f8] placeholder:text-[#71717a] font-mono leading-normal resize-none"
          />
        </div>

        <button
          onClick={handleSaveWallet}
          className="w-full bg-[#8b5cf6] text-white py-3 rounded-xl text-[13px] font-bold hover:bg-[#7c3aed] transition-colors"
        >
          Save Wallet Connection
        </button>
      </div>
    )
  }

  if (activeSubView === 'relays') {
    return (
      <div className="flex min-h-full flex-col bg-[#09090b] px-4 pb-6 pt-4 text-[#f7f7f8]">
        <button
          onClick={() => setActiveSubView('main')}
          className="flex items-center gap-2 text-[14px] font-semibold text-[#a78bfa] mb-6 hover:underline"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Settings
        </button>

        <h3 className="text-[18px] font-bold mb-1">Nostr Relays</h3>
        <p className="text-[11px] text-[#a1a1aa] mb-6">Manage the read/write relays for syncing your content feed.</p>

        <div className="flex flex-col gap-3 mb-6 bg-[#111115] p-4 rounded-xl border border-neutral-900">
          <input
            value={newRelayUrl}
            onChange={(e) => setNewRelayUrl(e.target.value)}
            placeholder="e.g. relay.damus.io"
            className="w-full bg-[#18181d] px-3 py-2 rounded-lg text-[13px] outline-none text-[#f7f7f8] placeholder:text-[#71717a]"
          />
          <div className="flex justify-between items-center text-[12px] px-1">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={newRelayRead} onChange={(e) => setNewRelayRead(e.target.checked)} />
              Read
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={newRelayWrite} onChange={(e) => setNewRelayWrite(e.target.checked)} />
              Write
            </label>
            <button
              onClick={handleAddRelay}
              className="flex items-center gap-1 bg-[#8b5cf6] text-white px-3 py-1.5 rounded-lg text-[12px] font-bold"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto max-h-[350px] mb-6 pr-1">
          {localRelays.map((relay) => (
            <div key={relay.url} className="flex items-center justify-between p-3 bg-[#18181d] rounded-xl text-[13px]">
              <div className="overflow-hidden mr-3">
                <p className="font-medium text-[#f7f7f8] truncate">{relay.url}</p>
                <p className="text-[10px] text-[#a1a1aa]">
                  {relay.read ? 'Read' : ''} {relay.read && relay.write ? '/' : ''} {relay.write ? 'Write' : ''}
                </p>
              </div>
              <button onClick={() => handleRemoveRelay(relay.url)} className="text-neutral-500 hover:text-red-400 p-1">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={handleSaveRelays}
          disabled={saving}
          className="w-full bg-[#8b5cf6] text-white py-3 rounded-xl text-[13px] font-bold disabled:opacity-50"
        >
          {saving ? 'Publishing list...' : 'Save and Publish List'}
        </button>
      </div>
    )
  }

  if (activeSubView === 'blossom') {
    return (
      <div className="flex min-h-full flex-col bg-[#09090b] px-4 pb-6 pt-4 text-[#f7f7f8]">
        <button
          onClick={() => setActiveSubView('main')}
          className="flex items-center gap-2 text-[14px] font-semibold text-[#a78bfa] mb-6 hover:underline"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Settings
        </button>

        <h3 className="text-[18px] font-bold mb-1">Blossom Servers</h3>
        <p className="text-[11px] text-[#a1a1aa] mb-6">Configure Blossom media servers for uploading your video clips.</p>

        <div className="flex items-center gap-2 mb-6 bg-[#111115] p-3 rounded-xl border border-neutral-900">
          <input
            value={newBlossomUrl}
            onChange={(e) => setNewBlossomUrl(e.target.value)}
            placeholder="e.g. cdn.nostr.build"
            className="flex-1 bg-[#18181d] px-3 py-2 rounded-lg text-[13px] outline-none text-[#f7f7f8] placeholder:text-[#71717a]"
          />
          <button
            onClick={handleAddBlossom}
            className="bg-[#8b5cf6] text-white p-2 rounded-lg"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto max-h-[350px] mb-6 pr-1">
          {localBlossom.map((url) => (
            <div key={url} className="flex items-center justify-between p-3 bg-[#18181d] rounded-xl text-[13px]">
              <p className="font-medium text-[#f7f7f8] truncate mr-3">{url}</p>
              <button onClick={() => handleRemoveBlossom(url)} className="text-neutral-500 hover:text-red-400 p-1">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={handleSaveBlossom}
          disabled={saving}
          className="w-full bg-[#8b5cf6] text-white py-3 rounded-xl text-[13px] font-bold disabled:opacity-50"
        >
          {saving ? 'Publishing servers...' : 'Save and Publish Servers'}
        </button>
      </div>
    )
  }

  if (activeSubView === 'nip96') {
    return (
      <div className="flex min-h-full flex-col bg-[#09090b] px-4 pb-6 pt-4 text-[#f7f7f8]">
        <button
          onClick={() => setActiveSubView('main')}
          className="flex items-center gap-2 text-[14px] font-semibold text-[#a78bfa] mb-6 hover:underline"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Settings
        </button>

        <h3 className="text-[18px] font-bold mb-1">NIP-96 Media Servers</h3>
        <p className="text-[11px] text-[#a1a1aa] mb-6">Configure NIP-96 compatible servers for uploading media clips.</p>

        <div className="flex items-center gap-2 mb-6 bg-[#111115] p-3 rounded-xl border border-neutral-900">
          <input
            value={newNip96Url}
            onChange={(e) => setNewNip96Url(e.target.value)}
            placeholder="e.g. nostr.build"
            className="flex-1 bg-[#18181d] px-3 py-2 rounded-lg text-[13px] outline-none text-[#f7f7f8] placeholder:text-[#71717a]"
          />
          <button
            onClick={handleAddNip96}
            className="bg-[#8b5cf6] text-white p-2 rounded-lg"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto max-h-[350px] mb-6 pr-1">
          {localNip96.map((url) => (
            <div key={url} className="flex items-center justify-between p-3 bg-[#18181d] rounded-xl text-[13px]">
              <p className="font-medium text-[#f7f7f8] truncate mr-3">{url}</p>
              <button onClick={() => handleRemoveNip96(url)} className="text-neutral-500 hover:text-red-400 p-1">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={handleSaveNip96}
          disabled={saving}
          className="w-full bg-[#8b5cf6] text-white py-3 rounded-xl text-[13px] font-bold disabled:opacity-50"
        >
          {saving ? 'Publishing servers...' : 'Save and Publish Servers'}
        </button>
      </div>
    )
  }

  if (activeSubView === 'mute') {
    return (
      <div className="flex min-h-full flex-col bg-[#09090b] px-4 pb-6 pt-4 text-[#f7f7f8]">
        <button
          onClick={() => setActiveSubView('main')}
          className="flex items-center gap-2 text-[14px] font-semibold text-[#a78bfa] mb-6 hover:underline"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Settings
        </button>

        <h3 className="text-[18px] font-bold mb-1">Mute Moderation</h3>
        <p className="text-[11px] text-[#a1a1aa] mb-6">Mute specific public keys or hashtags to filter your feed.</p>

        <div className="space-y-4 mb-6">
          <div className="bg-[#111115] p-3 rounded-xl border border-neutral-900">
            <p className="text-[11px] font-semibold text-[#a1a1aa] mb-2">Mute User Pubkey</p>
            <div className="flex items-center gap-2">
              <input
                value={newMutePubkey}
                onChange={(e) => setNewMutePubkey(e.target.value)}
                placeholder="Nostr pubkey hex..."
                className="flex-1 bg-[#18181d] px-3 py-2 rounded-lg text-[13px] outline-none text-[#f7f7f8]"
              />
              <button onClick={handleAddMutePubkey} className="bg-[#8b5cf6] text-white p-2 rounded-lg">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="bg-[#111115] p-3 rounded-xl border border-neutral-900">
            <p className="text-[11px] font-semibold text-[#a1a1aa] mb-2">Mute Hashtag / Word</p>
            <div className="flex items-center gap-2">
              <input
                value={newMuteTag}
                onChange={(e) => setNewMuteTag(e.target.value)}
                placeholder="e.g. clickbait"
                className="flex-1 bg-[#18181d] px-3 py-2 rounded-lg text-[13px] outline-none text-[#f7f7f8]"
              />
              <button onClick={handleAddMuteTag} className="bg-[#8b5cf6] text-white p-2 rounded-lg">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto max-h-[250px] mb-6 space-y-4 pr-1">
          {localMutePubkeys.length > 0 && (
            <div>
              <h4 className="text-[12px] font-bold text-[#a1a1aa] mb-1.5">Muted Users</h4>
              <div className="space-y-1.5">
                {localMutePubkeys.map((pk) => (
                  <div key={pk} className="flex items-center justify-between p-2.5 bg-[#18181d] rounded-lg text-[12px]">
                    <p className="font-mono text-[#f7f7f8] truncate mr-3">{pk.slice(0, 16)}...</p>
                    <button onClick={() => handleRemoveMutePubkey(pk)} className="text-neutral-500 hover:text-red-400 p-0.5">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {localMuteTags.length > 0 && (
            <div>
              <h4 className="text-[12px] font-bold text-[#a1a1aa] mb-1.5">Muted Tags</h4>
              <div className="space-y-1.5">
                {localMuteTags.map((tag) => (
                  <div key={tag} className="flex items-center justify-between p-2.5 bg-[#18181d] rounded-lg text-[12px]">
                    <p className="font-medium text-[#f7f7f8]">#{tag}</p>
                    <button onClick={() => handleRemoveMuteTag(tag)} className="text-neutral-500 hover:text-red-400 p-0.5">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={handleSaveMutes}
          disabled={saving}
          className="w-full bg-[#8b5cf6] text-white py-3 rounded-xl text-[13px] font-bold disabled:opacity-50"
        >
          {saving ? 'Publishing mute list...' : 'Save and Publish Mutes'}
        </button>
      </div>
    )
  }

  // Render Main Settings Menu
  return (
    <div className="flex min-h-full flex-col bg-[#09090b] px-4 pb-4 pt-4 text-[#f7f7f8]">
      <div className="flex h-[56px] items-center">
        <h2 className="text-[18px] font-bold">Settings</h2>
      </div>

      <div className="flex flex-1 flex-col">
        {/* Identity and Signer */}
        <div
          onClick={() => setActiveSubView('identity')}
          className="flex items-center justify-between py-[18px] cursor-pointer border-b border-neutral-900 hover:bg-[#111115]/50 px-2 rounded-xl transition-colors"
        >
          <div className="flex items-center gap-3">
            <Key className="w-4 h-4 text-[#a78bfa] shrink-0" />
            <div>
              <p className="text-[14px] font-medium text-[#f7f7f8]">Identity and signer</p>
              <p className="text-[11px] font-normal text-[#a1a1aa]">
                {session.method.toUpperCase()} Connected
              </p>
            </div>
          </div>
          <span className="text-[20px] text-[#71717a]">›</span>
        </div>

        {/* Wallet Connection */}
        <div
          onClick={() => setActiveSubView('wallet')}
          className="flex items-center justify-between py-[18px] cursor-pointer border-b border-neutral-900 hover:bg-[#111115]/50 px-2 rounded-xl transition-colors"
        >
          <div className="flex items-center gap-3">
            <Wallet className="w-4 h-4 text-[#a78bfa] shrink-0" />
            <div>
              <p className="text-[14px] font-medium text-[#f7f7f8]">Wallet Connection</p>
              <p className="text-[11px] font-normal text-[#a1a1aa]">
                {localWalletString ? 'NWC Configured' : 'Not configured'}
              </p>
            </div>
          </div>
          <span className="text-[20px] text-[#71717a]">›</span>
        </div>

        {/* Read/Write Relays */}
        <div
          onClick={() => setActiveSubView('relays')}
          className="flex items-center justify-between py-[18px] cursor-pointer border-b border-neutral-900 hover:bg-[#111115]/50 px-2 rounded-xl transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-4" /> {/* Spacer */}
            <div>
              <p className="text-[14px] font-medium text-[#f7f7f8]">Nostr Relays</p>
              <p className="text-[11px] font-normal text-[#a1a1aa]">
                {localRelays.length} relays configured
              </p>
            </div>
          </div>
          <span className="text-[20px] text-[#71717a]">›</span>
        </div>

        {/* Blossom Servers */}
        <div
          onClick={() => setActiveSubView('blossom')}
          className="flex items-center justify-between py-[18px] cursor-pointer border-b border-neutral-900 hover:bg-[#111115]/50 px-2 rounded-xl transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-4" /> {/* Spacer */}
            <div>
              <p className="text-[14px] font-medium text-[#f7f7f8]">Blossom Media Servers</p>
              <p className="text-[11px] font-normal text-[#a1a1aa]">
                {localBlossom.length} media servers
              </p>
            </div>
          </div>
          <span className="text-[20px] text-[#71717a]">›</span>
        </div>

        {/* NIP-96 Servers */}
        <div
          onClick={() => setActiveSubView('nip96')}
          className="flex items-center justify-between py-[18px] cursor-pointer border-b border-neutral-900 hover:bg-[#111115]/50 px-2 rounded-xl transition-colors"
        >
          <div className="flex items-center gap-3">
            <UploadCloud className="w-4 h-4 text-[#a78bfa] shrink-0" />
            <div>
              <p className="text-[14px] font-medium text-[#f7f7f8]">NIP-96 Upload Servers</p>
              <p className="text-[11px] font-normal text-[#a1a1aa]">
                {localNip96.length} NIP-96 servers
              </p>
            </div>
          </div>
          <span className="text-[20px] text-[#71717a]">›</span>
        </div>

        {/* Muted Users and Tags */}
        <div
          onClick={() => setActiveSubView('mute')}
          className="flex items-center justify-between py-[18px] cursor-pointer border-b border-neutral-900 hover:bg-[#111115]/50 px-2 rounded-xl transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-4" /> {/* Spacer */}
            <div>
              <p className="text-[14px] font-medium text-[#f7f7f8]">Muted Users and Tags</p>
              <p className="text-[11px] font-normal text-[#a1a1aa]">
                {localMutePubkeys.length} users, {localMuteTags.length} tags muted
              </p>
            </div>
          </div>
          <span className="text-[20px] text-[#71717a]">›</span>
        </div>
      </div>
    </div>
  )
}
