import { generateSecretKey, getPublicKey, nip04, SimplePool } from 'nostr-tools'

interface Nip46Request {
  id: string
  method: string
  params: string[]
}

interface Nip46Response {
  id: string
  result?: string
  error?: string
}

export interface Nip46ConnectionParams {
  signerPubkey: string
  relayUrl: string
  secret?: string
}

export function parseBunkerUrl(url: string): Nip46ConnectionParams {
  const clean = url.replace(/^bunker:\/\//, '')
  const [pubkeyPart, ...queryParts] = clean.split('?')
  const signerPubkey = pubkeyPart.trim()
  if (!signerPubkey) throw new Error('Missing signer pubkey in bunker URL')
  const params = new URLSearchParams(queryParts.join('?'))
  const relayUrl = params.get('relay') || ''
  const secret = params.get('secret') || undefined
  if (!relayUrl) throw new Error('No relay specified in bunker URL')
  return { signerPubkey, relayUrl, secret }
}

let idCounter = 0
function generateId(): string {
  return `nip46-${++idCounter}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export class Nip46Signer {
  private pool: SimplePool
  private relayUrl: string
  private signerPubkey: string
  private secret?: string
  private userPubkey: string | null = null
  private ephemeralPrivkey: Uint8Array
  private ephemeralPubkey: string
  private pendingRequests: Map<string, PendingRequest> = new Map()
  private subscription: { close: () => void } | null = null

  constructor(pool: SimplePool, params: Nip46ConnectionParams) {
    this.pool = pool
    this.relayUrl = params.relayUrl
    this.signerPubkey = params.signerPubkey
    this.secret = params.secret
    this.ephemeralPrivkey = generateSecretKey()
    this.ephemeralPubkey = getPublicKey(this.ephemeralPrivkey)
  }

  get connected(): boolean {
    return this.userPubkey !== null
  }

  get sessionPubkey(): string | null {
    return this.userPubkey
  }

  async connect(): Promise<string> {
    const connectParams = [this.ephemeralPubkey]
    if (this.secret) connectParams.push(this.secret)

    const response = await this.sendRequest('connect', connectParams)
    this.userPubkey = response.result || null
    if (!this.userPubkey) throw new Error('NIP-46 connect failed: no pubkey in response')
    return this.userPubkey
  }

  async getPublicKey(): Promise<string> {
    if (this.userPubkey) return this.userPubkey
    return this.connect()
  }

  async signEvent(event: any): Promise<any> {
    if (!this.userPubkey) throw new Error('Not connected to remote signer')
    const response = await this.sendRequest('sign_event', [this.userPubkey, JSON.stringify(event)])
    if (!response.result) throw new Error('Remote signing failed')
    return JSON.parse(response.result)
  }

  close() {
    this.subscription?.close()
    this.subscription = null
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('NIP-46 connection closed'))
    }
    this.pendingRequests.clear()
  }

  private async sendRequest(method: string, params: string[]): Promise<Nip46Response> {
    const id = generateId()
    const request: Nip46Request = { id, method, params }
    const requestJson = JSON.stringify(request)

    const encrypted = await nip04.encrypt(this.ephemeralPrivkey, this.signerPubkey, requestJson)

    const event = {
      kind: 24133,
      pubkey: this.ephemeralPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', this.signerPubkey]],
      content: encrypted,
    }

    const responsePromise = new Promise<Nip46Response>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`NIP-46 ${method} timed out after 30s`))
      }, 30000)
      this.pendingRequests.set(id, {
        resolve: (r: Nip46Response) => { clearTimeout(timeout); resolve(r) },
        reject: (e: Error) => { clearTimeout(timeout); reject(e) },
      })
    })

    this.ensureSubscribed()
    await Promise.any(this.pool.publish([this.relayUrl], event))

    return responsePromise
  }

  private ensureSubscribed() {
    if (this.subscription) return

    this.subscription = this.pool.subscribeMany(
      [this.relayUrl],
      [{ kinds: [24133], authors: [this.signerPubkey], '#p': [this.ephemeralPubkey] }],
      {
        onevent: async (event: any) => {
          try {
            const decrypted = await nip04.decrypt(this.ephemeralPrivkey, this.signerPubkey, event.content)
            const response: Nip46Response = JSON.parse(decrypted)

            const pending = this.pendingRequests.get(response.id)
            if (pending) {
              this.pendingRequests.delete(response.id)
              if (response.error) {
                pending.reject(new Error(response.error))
              } else {
                pending.resolve(response)
              }
            }
          } catch (err) {
            console.warn('[NIP-46] Failed to decrypt or handle response:', err)
          }
        },
      }
    )
  }
}

interface PendingRequest {
  resolve: (r: Nip46Response) => void
  reject: (e: Error) => void
}
