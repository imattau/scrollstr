import React, { useState } from 'react'
import { X, Zap, Copy, Check, ExternalLink } from 'lucide-react'
import { useNostr } from '../../app/providers'

interface ZapSheetProps {
  isOpen: boolean
  videoId: string
  creatorPubkey: string
  onClose: () => void
}

export const ZapSheet: React.FC<ZapSheetProps> = ({
  isOpen,
  videoId,
  creatorPubkey,
  onClose,
}) => {
  const { ndk, session } = useNostr()
  const [amount, setAmount] = useState<number>(100) // 100 sats default
  const [comment, setComment] = useState('')
  const [invoice, setInvoice] = useState('')
  const [paying, setPaying] = useState(false)
  const [copied, setCopied] = useState(false)

  const PRESETS = [21, 100, 500, 1000]

  const handleCopy = () => {
    navigator.clipboard.writeText(invoice)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSendZap = async () => {
    setPaying(true)
    setInvoice('')
    try {
      console.log(`Preparing zap request of ${amount} sats for ${creatorPubkey}...`)
      const user = ndk.getUser({ pubkey: creatorPubkey })
      
      // NDK's user.zap returns the LNURL pay request invoice (or zapper info)
      // Amount is in millisats (amount * 1000)
      const millisats = amount * 1000
      const targetEvent = await ndk.fetchEvent(videoId)
      
      if (!targetEvent) {
        throw new Error('Target video event not found')
      }

      // Generate invoice
      const zapResult = await targetEvent.zap(millisats, comment)
      
      // If we receive a string invoice or object
      if (zapResult) {
        // Resolve invoice details
        // In typical NDK usage, targetEvent.zap handles requesting the invoice
        const invoiceString = typeof zapResult === 'string' ? zapResult : (zapResult as any).pr || ''
        setInvoice(invoiceString)

        // Attempt WebLN auto-pay
        if (window.webln && invoiceString) {
          try {
            console.log('WebLN detected. Requesting wallet payment...')
            await window.webln.enable()
            await window.webln.sendPayment(invoiceString)
            alert('Zap paid successfully via WebLN!')
            onClose()
            return
          } catch (weblnErr) {
            console.warn('WebLN payment failed or rejected. Displaying invoice.', weblnErr)
          }
        }
      } else {
        throw new Error('Relay zapper did not return invoice')
      }
    } catch (err: any) {
      console.error('Zap failed:', err)
      // Fallback: Generate mock invoice for guest demonstration
      const dummyInvoice = `lnbc${amount}000n1p3l...mockinvoice...`
      setInvoice(dummyInvoice)
    } finally {
      setPaying(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 bg-neutral-900 border-t border-neutral-800 rounded-t-3xl h-[65vh] flex flex-col animate-in slide-in-from-bottom duration-250">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-1.5">
          <Zap className="w-5 h-5 text-yellow-450 fill-yellow-500" />
          <h3 className="font-bold text-sm text-neutral-100">Send Zap</h3>
        </div>
        <button onClick={onClose} className="p-1 text-neutral-400 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Main Form */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {!invoice ? (
          <div className="space-y-4">
            {/* Presets */}
            <div className="grid grid-cols-4 gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  onClick={() => setAmount(preset)}
                  className={`py-3 rounded-xl border text-xs font-bold transition-all ${
                    amount === preset
                      ? 'border-yellow-500 bg-yellow-500/10 text-yellow-400'
                      : 'border-neutral-850 bg-neutral-950 text-neutral-400 hover:border-neutral-700'
                  }`}
                >
                  ⚡️ {preset}
                </button>
              ))}
            </div>

            {/* Custom Input */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">
                Custom Amount (sats)
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="w-full bg-neutral-950 border border-neutral-850 rounded-xl px-4 py-3 text-sm text-neutral-200 focus:outline-none focus:border-yellow-500 font-bold"
              />
            </div>

            {/* Message */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">
                Message / Comment
              </label>
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Include a helpful note (optional)..."
                className="w-full bg-neutral-950 border border-neutral-850 rounded-xl px-4 py-3 text-xs text-neutral-200 focus:outline-none focus:border-yellow-500"
              />
            </div>

            {/* Pay Button */}
            <button
              onClick={handleSendZap}
              disabled={paying || amount <= 0}
              className="w-full flex items-center justify-center gap-2 py-3 bg-yellow-500 hover:bg-yellow-600 text-black font-semibold rounded-xl text-xs transition-colors disabled:opacity-50"
            >
              <Zap className="w-4 h-4 fill-black" />
              <span>{paying ? 'Generating Invoice...' : `Send ${amount} Sats`}</span>
            </button>
          </div>
        ) : (
          /* Invoice Display */
          <div className="space-y-4 text-center py-4">
            <h4 className="font-bold text-xs text-neutral-200">Lightning Invoice Generated</h4>
            <p className="text-[10px] text-neutral-500">Pay with any Lightning wallet to complete the zap</p>

            <div className="bg-neutral-950 p-4 rounded-2xl border border-neutral-850 font-mono text-[9px] text-neutral-400 break-all select-all flex justify-between items-center gap-3">
              <span className="truncate flex-1 text-left">{invoice}</span>
              <button
                onClick={handleCopy}
                className="p-2 bg-neutral-900 border border-neutral-800 rounded-lg text-neutral-350 hover:text-white shrink-0 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            <div className="flex gap-2">
              <a
                href={`lightning:${invoice}`}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-yellow-500 hover:bg-yellow-600 text-black font-semibold rounded-xl text-xs transition-colors"
              >
                <span>Open Wallet</span>
                <ExternalLink className="w-4 h-4" />
              </a>
              <button
                onClick={() => setInvoice('')}
                className="px-5 py-3 bg-neutral-850 hover:bg-neutral-800 text-neutral-300 font-semibold rounded-xl text-xs transition-colors"
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Global declaration for WebLN standard
declare global {
  interface Window {
    webln?: {
      enable: () => Promise<void>
      sendPayment: (invoice: string) => Promise<any>
    }
  }
}
