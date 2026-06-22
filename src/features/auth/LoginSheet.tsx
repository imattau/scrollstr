import React, { useState } from 'react'
import { ArrowRight, Eye, Key, ShieldCheck, Sparkles, X } from 'lucide-react'
import { useNostr } from '../../app/providers'
import { hasStoredPasskeyIdentity } from 'nostr-passkey'

interface LoginSheetProps {
  isOpen: boolean
  onClose: () => void
  onLoginSuccess: () => void
}

function OptionCard({
  title,
  description,
  icon,
  badge,
  onClick,
  subtle = false,
}: {
  title: string
  description: string
  icon: React.ReactNode
  badge?: string
  onClick?: () => void
  subtle?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'group flex w-full items-start gap-4 rounded-[20px] border px-4 py-4 text-left transition-all duration-200',
        subtle
          ? 'border-[#23232a] bg-[#111115] hover:border-[#34343d] hover:bg-[#141419]'
          : 'border-[#2a2a31] bg-[#18181d] hover:border-[#3a3a45] hover:bg-[#1c1c23]',
      ].join(' ')}
    >
      <div
        className={[
          'mt-0.5 flex size-[42px] shrink-0 items-center justify-center rounded-[14px] border text-[#f7f7f8]',
          subtle ? 'border-[#2a2a31] bg-[#18181d]' : 'border-[#3b3b47] bg-[#222228]',
        ].join(' ')}
      >
        {icon}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[15px] font-semibold text-[#f7f7f8]">{title}</p>
          {badge ? (
            <span className="rounded-full border border-[#3b3b47] bg-[#222228] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#d4d4d8]">
              {badge}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-[12px] leading-normal text-[#a1a1aa]">{description}</p>
      </div>

      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[#71717a] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#f7f7f8]" />
    </button>
  )
}

export const LoginSheet: React.FC<LoginSheetProps> = ({ isOpen, onClose, onLoginSuccess }) => {
  const { loginWithNip07, loginReadOnly, loginWithPasskey, registerPasskey } = useNostr()
  const [npub, setNpub] = useState('')
  const [nip46Address, setNip46Address] = useState('')
  const [error, setError] = useState('')
  const [hasPasskey, setHasPasskey] = useState(false)

  React.useEffect(() => {
    if (isOpen) {
      setHasPasskey(hasStoredPasskeyIdentity())
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleNip07Login = async () => {
    setError('')
    try {
      await loginWithNip07()
      onLoginSuccess()
    } catch (err: any) {
      setError(err.message || 'Browser extension login failed')
    }
  }

  const handleNip46Login = () => {
    setError('')
    if (!nip46Address.trim()) {
      setError('Please enter a remote signer address')
      return
    }

    alert(`NIP-46 connect simulated for ${nip46Address}`)
    onLoginSuccess()
  }

  const handleReadOnlyLogin = () => {
    setError('')
    if (!npub.trim()) {
      setError('Please enter an npub key or hex pubkey')
      return
    }

    try {
      loginReadOnly(npub)
      onLoginSuccess()
    } catch (err: any) {
      setError(err.message || 'Failed to load read-only profile')
    }
  }

  const handlePasskeyLogin = async () => {
    setError('')
    try {
      if (hasPasskey) {
        await loginWithPasskey()
      } else {
        await registerPasskey()
      }
      onLoginSuccess()
    } catch (err: any) {
      console.error(err)
      setError(err.message || 'Passkey authentication failed')
    }
  }

  const handleGuestBrowse = () => {
    setError('')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/85 px-0 backdrop-blur-sm md:items-center md:px-6">
      <div className="hidden md:block absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(168,85,247,0.18),transparent_32%),radial-gradient(circle_at_80%_0%,rgba(96,165,250,0.16),transparent_28%),linear-gradient(180deg,rgba(9,9,11,0.72),rgba(9,9,11,0.92))]" />

      <div className="relative flex h-[70vh] w-full max-w-[390px] flex-col overflow-hidden rounded-t-[28px] border border-[#2a2a31] bg-[#09090b] md:h-[760px] md:max-h-[calc(100vh-48px)] md:max-w-[1120px] md:flex-row md:rounded-[34px]">
        <div className="hidden md:flex md:w-[48%] md:flex-col md:justify-between md:overflow-hidden md:border-r md:border-[#1b1b22] md:bg-[radial-gradient(circle_at_25%_20%,rgba(99,102,241,0.2),transparent_25%),radial-gradient(circle_at_70%_30%,rgba(236,72,153,0.2),transparent_20%),linear-gradient(180deg,#13131a_0%,#0f0f15_55%,#09090b_100%)] md:p-8">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-[#a1a1aa]">Nostr Clips</p>
              <p className="text-[22px] font-bold text-[#f7f7f8]">Open video on the web</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[#f7f7f8] transition-colors hover:bg-white/10"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="relative flex flex-1 items-center justify-center">
            <div className="absolute left-6 top-10 h-44 w-44 rounded-full bg-fuchsia-500/20 blur-3xl" />
            <div className="absolute right-8 top-24 h-52 w-52 rounded-full bg-sky-500/20 blur-3xl" />

            <div className="relative flex h-[500px] w-[420px] flex-col justify-between rounded-[34px] border border-white/10 bg-white/5 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <div className="text-[14px] font-semibold text-[#f7f7f8]">Nostr Clips</div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#d4d4d8]">
                  Desktop
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-[16px] bg-[#f7f7f8] text-[18px] font-black text-[#09090b]">
                    N
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-[#d4d4d8]">Sign in to publish, react, and comment</p>
                    <p className="text-[12px] text-[#a1a1aa]">Choose a signer, then continue into the feed.</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#a1a1aa]">Following</p>
                    <p className="mt-3 text-[28px] font-bold text-[#f7f7f8]">24</p>
                    <p className="mt-1 text-[12px] text-[#a1a1aa]">Creators in your stream</p>
                  </div>
                  <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#a1a1aa]">Explore</p>
                    <p className="mt-3 text-[28px] font-bold text-[#f7f7f8]">148</p>
                    <p className="mt-1 text-[12px] text-[#a1a1aa]">Comments ready to read</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
                <div className="flex items-center gap-2 text-[#d4d4d8]">
                  <Sparkles className="h-4 w-4 text-[#f5b942]" />
                  <p className="text-[12px] font-semibold">Designed for short-form clips and public replies</p>
                </div>
                <p className="text-[12px] leading-normal text-[#a1a1aa]">
                  Follow creators, boost clips, or sign in with a private signer before you post.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex h-full flex-col overflow-hidden md:w-[52%] md:bg-[#09090b]">
          <div className="flex items-center justify-between px-4 py-4 md:px-8 md:pt-8">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#a1a1aa]">Welcome back</p>
              <h2 className="mt-2 text-[20px] font-bold text-[#f7f7f8] md:text-[28px]">Sign in to Nostr Clips</h2>
              <p className="mt-2 max-w-[360px] text-[12px] leading-normal text-[#a1a1aa] md:text-[14px]">
                Pick a signing method to follow, comment, boost, zap, and upload clips.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex size-10 items-center justify-center rounded-full border border-[#2a2a31] bg-[#111115] text-[#f7f7f8] transition-colors hover:bg-[#18181d]"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {error ? (
            <div className="mx-4 mb-4 rounded-[16px] border border-red-500/20 bg-red-500/10 px-4 py-3 text-[12px] text-red-300 md:mx-8">
              {error}
            </div>
          ) : null}

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 md:px-8 md:pb-8">
            <OptionCard
              title="Browser extension"
              description="Use Alby, nos2x, or another NIP-07 signer in your browser."
              icon={<ShieldCheck className="h-5 w-5 text-[#f7f7f8]" />}
              onClick={handleNip07Login}
            />

            <OptionCard
              title={hasPasskey ? 'Unlock Passkey' : 'Create Passkey'}
              description={hasPasskey ? 'Use your device passkey (TouchID/FaceID) to sign in.' : 'Create a new secure Nostr identity using a device passkey.'}
              icon={<Key className="h-5 w-5 text-[#f5b942]" />}
              badge="Recommended"
              onClick={handlePasskeyLogin}
              subtle
            />

            <OptionCard
              title="Remote signer"
              description="Connect a bunker or remote NIP-46 signer."
              icon={<Eye className="h-5 w-5 text-[#f7f7f8]" />}
              onClick={handleNip46Login}
            />

            <div className="relative flex items-center py-3">
              <div className="flex-1 border-t border-[#23232a]" />
              <span className="mx-4 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#71717a]">Or continue</span>
              <div className="flex-1 border-t border-[#23232a]" />
            </div>

            <button
              type="button"
              onClick={handleGuestBrowse}
              className="flex w-full items-center justify-between rounded-[20px] border border-[#2a2a31] bg-[#f7f7f8] px-4 py-4 text-left text-[#09090b] transition-colors hover:bg-white"
            >
              <div>
                <p className="text-[15px] font-semibold">Continue as guest</p>
                <p className="mt-1 text-[12px] text-[#52525b]">Browse the feed without signing in.</p>
              </div>
              <ArrowRight className="h-4 w-4" />
            </button>

            <p className="px-1 text-[11px] leading-normal text-[#71717a]">
              We only store your session locally. Your signer or extension remains in control of identity and
              publishing.
            </p>

            <div className="mt-3 rounded-[20px] border border-[#23232a] bg-[#111115] p-4 md:hidden">
              <p className="text-[12px] font-semibold text-[#f7f7f8]">Read-only / remote access</p>
              <p className="mt-1 text-[11px] leading-normal text-[#a1a1aa]">
                Enter an npub to browse as a reader, or connect a bunker address.
              </p>
              <div className="mt-4 space-y-3">
                <div className="space-y-2">
                  <label className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-[#71717a]">
                    Read-only npub
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={npub}
                      onChange={(e) => setNpub(e.target.value)}
                      placeholder="npub1..."
                      className="flex-1 rounded-[14px] border border-[#2a2a31] bg-[#09090b] px-3 py-2 text-[12px] text-[#f7f7f8] outline-none placeholder:text-[#71717a]"
                    />
                    <button
                      type="button"
                      onClick={handleReadOnlyLogin}
                      className="rounded-[14px] bg-[#18181d] px-4 text-[12px] font-semibold text-[#f7f7f8]"
                    >
                      Watch
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-[#71717a]">
                    Remote signer
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={nip46Address}
                      onChange={(e) => setNip46Address(e.target.value)}
                      placeholder="bunker://..."
                      className="flex-1 rounded-[14px] border border-[#2a2a31] bg-[#09090b] px-3 py-2 text-[12px] text-[#f7f7f8] outline-none placeholder:text-[#71717a]"
                    />
                    <button
                      type="button"
                      onClick={handleNip46Login}
                      className="rounded-[14px] bg-[#18181d] px-4 text-[12px] font-semibold text-[#f7f7f8]"
                    >
                      Connect
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
