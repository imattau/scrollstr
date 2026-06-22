import NDK, { NDKEvent } from '@nostr-dev-kit/ndk'

// Helper to calculate SHA-256 hash of a file/blob locally using Web Crypto API
export const calculateSha256 = async (blob: Blob): Promise<string> => {
  const arrayBuffer = await blob.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Generate a signed Blossom (BUD-11) upload authorization token
export const generateBlossomAuthHeader = async (
  ndk: NDK,
  sha256Hash: string,
  serverUrl: string
): Promise<string> => {
  if (!ndk.signer) {
    throw new Error('Nostr signer not available for upload authorization')
  }

  // Create kind:24242 event
  const event = new NDKEvent(ndk)
  event.kind = 24242
  event.content = 'Authorize upload'
  event.tags = [
    ['t', 'upload'],
    ['x', sha256Hash],
    ['expiration', (Math.floor(Date.now() / 1000) + 300).toString()], // Valid for 5 minutes
  ]

  // Sign event
  await event.sign()
  const jsonString = JSON.stringify(event.rawEvent())
  
  // Base64 encode the stringified JSON event
  const base64Token = btoa(unescape(encodeURIComponent(jsonString)))
  return `Nostr ${base64Token}`
}

// Upload a blob to a configured Blossom server
export const uploadToBlossom = async (
  ndk: NDK,
  blob: Blob,
  serverUrl: string
): Promise<{ url: string; sha256: string }> => {
  const sha256 = await calculateSha256(blob)
  
  // Clean up server URL trailing slash
  const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl
  const uploadUrl = `${baseUrl}/upload`

  console.log(`Hashing complete. SHA-256: ${sha256}`)
  const authHeader = await generateBlossomAuthHeader(ndk, sha256, baseUrl)

  console.log(`Uploading file to ${uploadUrl}...`)
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: blob,
    headers: {
      'Authorization': authHeader,
      'Content-Type': blob.type,
      'X-SHA-256': sha256,
    },
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Upload failed with status ${response.status}: ${errorText}`)
  }

  // Blossom BUD-01 returns a Descriptor object containing "url" and "sha256"
  const descriptor = await response.json()
  return {
    url: descriptor.url || `${baseUrl}/${sha256}`,
    sha256,
  }
}
