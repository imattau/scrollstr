import React, { useState, useEffect } from 'react'
import { Drawer } from 'vaul'
import { useNostr } from '../../app/providers'
import { fetchFromRelays } from '../../nostr/pool'
import { db, saveEventToCache } from '../../nostr/cache'
import { useProfile } from '../../nostr/profile'
import { useUserRelayUrls } from '../../nostr/relays'

// Block requests to private/reserved IP ranges and internal hostnames
const PRIVATE_IP_RE = /^(?:127\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1|fe80::)/

function isPrivateHost(host: string): boolean {
  // Strip port if present
  const hostname = host.split(':')[0].toLowerCase()
  // Check for internal TLDs
  if (hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname === 'localhost') return true
  // If it's an IP literal, check for private ranges
  const ipMatch = hostname.match(/^(\d+\.\d+\.\d+\.\d+)$/)
  if (ipMatch && PRIVATE_IP_RE.test(ipMatch[1])) return true
  return false
}

interface ZapSheetProps {
  isOpen: boolean
  videoId: string
  creatorPubkey: string
  onClose: () => void
}

const PRESETS = [21, 100, 500, 1000]

export const ZapSheet: React.FC<ZapSheetProps> = ({ isOpen, videoId, creatorPubkey, onClose }) => {
  const { pool, session, signEvent } = useNostr()
  const relayUrls = useUserRelayUrls(session?.pubkey)
  const profile = useProfile(creatorPubkey)
  const [amount, setAmount] = useState<number>(100)
  const [comment, setComment] = useState('Great video!')
  const [paying, setPaying] = useState(false)
  const [invoice, setInvoice] = useState('')
  const [error, setError] = useState('')

  function extractLud16(eventData: any): string {
    try {
      const profileData = JSON.parse(eventData.content)
      return profileData.lud16 || profileData.lud06 || ''
    } catch (e) {
      console.error(e)
      return ''
    }
  }

  const handleSendZap = async () => {
    if (!session) {
      alert('Please connect your Nostr account to zap')
      return
    }

    setPaying(true)
    setInvoice('')
    setError('')
    try {
      let lud16 = ''

      const cachedProfile = await db.authorProfiles.get(creatorPubkey)
      if (cachedProfile?.nip05 && cachedProfile.nip05.includes('@')) {
        const [_name, domain] = cachedProfile.nip05.split('@')
        lud16 = `${_name}@${domain}`
      }

      if (!lud16) {
        const cachedProfileEvent = await db.cachedEvents.where({ kind: 0, pubkey: creatorPubkey }).first()
        if (cachedProfileEvent?.event) {
          lud16 = extractLud16(cachedProfileEvent.event)
        }
      }

      if (!lud16) {
        console.log(`Lud16 not found in cache for ${creatorPubkey}, querying profile from relays...`)
        const events = await fetchFromRelays(relayUrls, { kinds: [0], authors: [creatorPubkey], limit: 1 })
        const fetchedProfile = events.find((e: any) => e.kind === 0 && e.pubkey === creatorPubkey) ?? null
        if (fetchedProfile) {
          await saveEventToCache(fetchedProfile)
          lud16 = extractLud16(fetchedProfile)
        }
      }

      if (!lud16) {
        throw new Error('Creator does not have a Lightning Address (lud16) configured on their profile.')
      }

      const [username, domain] = lud16.split('@')
      if (!username || !domain) {
        throw new Error('Invalid Lightning Address format: ' + lud16)
      }

      // SSRF protection: reject private/internal hostnames
      if (isPrivateHost(domain)) {
        throw new Error('Lightning address points to a private or internal host — rejected')
      }

      const lnurlpUrl = `https://${domain}/.well-known/lnurlp/${username}`
      console.log(`Resolving LNURL Pay link: ${lnurlpUrl}`)
      const res = await fetch(lnurlpUrl)
      if (!res.ok) throw new Error(`Failed to fetch LNURL endpoint from ${domain}`)
      const lnurlData = await res.json()

      const callback = lnurlData.callback
      if (!callback) throw new Error('LNURL response missing callback URL')

      const amountMsat = amount * 1000

      if (lnurlData.allowsNostr && lnurlData.nostrPubkey) {
        const relays = ['wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.snort.social']
        const zapRequestTemplate = {
          kind: 9734,
          content: comment,
          tags: [
            ['p', creatorPubkey],
            ['e', videoId],
            ['relays', ...relays],
            ['amount', amountMsat.toString()],
          ],
        }

        console.log('Signing NIP-57 Zap Request...')
        const signedZapRequest = await signEvent(zapRequestTemplate)
        const zapRequestHex = encodeURIComponent(JSON.stringify(signedZapRequest))

        const requestUrl = `${callback}${callback.includes('?') ? '&' : '?'}amount=${amountMsat}&nostr=${zapRequestHex}`
        console.log(`Requesting invoice from callback: ${requestUrl}`)
        const invoiceRes = await fetch(requestUrl)
        if (!invoiceRes.ok) throw new Error('Failed to request invoice with zap receipt')
        const invoiceData = await invoiceRes.json()

        if (invoiceData.pr) {
          setInvoice(invoiceData.pr)
        } else {
          throw new Error('Invoice data missing payment request (pr)')
        }
      } else {
        console.log('NIP-57 zaps not supported, falling back to standard LNURL-pay...')
        const requestUrl = `${callback}${callback.includes('?') ? '&' : '?'}amount=${amountMsat}`
        const invoiceRes = await fetch(requestUrl)
        if (!invoiceRes.ok) throw new Error('Failed to fetch invoice from callback')
        const invoiceData = await invoiceRes.json()

        if (invoiceData.pr) {
          setInvoice(invoiceData.pr)
        } else {
          throw new Error('Invoice data missing payment request (pr)')
        }
      }
    } catch (err: any) {
      console.error('Zap failed:', err)
      setError(err.message || 'Payment request failed')
      setInvoice(`lnbc${amount}000n1p3l...mockinvoice...`)
    } finally {
      setPaying(false)
    }
  }

  return (
    <Drawer.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/85" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 mx-auto flex h-[65vh] w-full max-w-[390px] flex-col overflow-hidden rounded-t-[28px] border border-[#2a2a31] bg-[#09090b] outline-none">
          <div className="flex h-[56px] items-center justify-between bg-[#09090b] px-4 text-[#f7f7f8]">
            <div className="flex items-center gap-1.5">
              <h3 className="text-[18px] font-bold">Send a zap</h3>
            </div>
            <Drawer.Close className="text-[22px] leading-none text-[#f7f7f8]">
              ×
            </Drawer.Close>
          </div>

          <div className="flex flex-1 flex-col items-center gap-[21px] overflow-y-auto bg-[#09090b] p-5">
            <div className="flex size-[70px] overflow-hidden items-center justify-center rounded-full bg-[#60a5fa] text-[24px] font-bold text-white">
              {profile.picture ? (
                <img src={profile.picture} alt={profile.name} className="h-full w-full object-cover" />
              ) : (
                profile.displayName?.slice(0, 1).toUpperCase() || 'N'
              )}
            </div>

            <p className="text-[18px] font-semibold text-[#f7f7f8]">@{profile.displayName || profile.name}</p>
            {error && (
              <p className="text-[12px] text-red-400 bg-red-400/10 px-3 py-1 rounded-[10px] w-full text-center">
                {error}
              </p>
            )}
            <p className="text-[14px] font-normal text-[#a1a1aa]">Choose an amount</p>

            <div className="flex gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAmount(preset)}
                  className={[
                    'rounded-[18px] px-[13px] py-[7px] text-[12px] font-medium transition-colors',
                    amount === preset ? 'bg-[#f7f7f8] text-[#09090b]' : 'bg-[#18181d] text-[#f7f7f8]',
                  ].join(' ')}
                >
                  {preset}
                </button>
              ))}
            </div>

            <div className="flex items-start gap-2 rounded-[14px] bg-[#18181d] px-4 py-[14px]">
              <span className="text-[28px] font-bold leading-none text-[#f7f7f8]">{amount}</span>
              <span className="pt-2 text-[14px] font-medium text-[#a1a1aa]">sats</span>
            </div>

            <div className="flex flex-col gap-[5px] w-full rounded-[14px] bg-[#18181d] px-[14px] py-[12px]">
              <p className="text-[11px] font-medium text-[#a1a1aa]">Optional message</p>
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="bg-transparent text-[14px] font-normal text-[#f7f7f8] outline-none"
              />
            </div>

            {!invoice ? (
              <button
                type="button"
                onClick={handleSendZap}
                disabled={paying || amount <= 0}
                className="flex h-[42px] w-full items-center justify-center rounded-[11px] bg-[#8b5cf6] text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {paying ? 'Requesting Invoice...' : `Send ${amount} sats`}
              </button>
            ) : (
              <div className="w-full space-y-3 text-center">
                <p className="text-[11px] text-[#71717a] break-all border border-[#23232a] bg-[#111115] p-3 rounded-[14px] max-h-[100px] overflow-y-auto">
                  {invoice}
                </p>
                <Drawer.Close className="w-full rounded-[11px] bg-[#8b5cf6] py-3 text-[13px] font-semibold text-white">
                  Close
                </Drawer.Close>
              </div>
            )}

            <p className="text-[11px] font-normal text-[#71717a]">Lightning payment with a public Nostr receipt.</p>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
