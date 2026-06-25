import { NostrConnectSigner } from 'applesauce-signers/signers/nostr-connect-signer'
import { parseBunkerURI } from 'applesauce-signers/helpers/nostr-connect'
import { nostrPool } from './pool'

NostrConnectSigner.pool = nostrPool

export { NostrConnectSigner }

export type Nip46ConnectionParams = {
  signerPubkey: string
  relayUrl: string
  secret?: string
}

export function parseBunkerUrl(url: string): Nip46ConnectionParams {
  const parsed = parseBunkerURI(url)
  return {
    signerPubkey: parsed.remote,
    relayUrl: parsed.relays[0] ?? '',
    secret: parsed.secret,
  }
}
