// Helper to calculate SHA-256 hash of a file/blob locally using Web Crypto API
export const calculateSha256 = async (blob: Blob): Promise<string> => {
  const arrayBuffer = await blob.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Generate a signed Blossom (BUD-11) upload authorization token
export const generateBlossomAuthHeader = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  sha256Hash: string,
  serverUrl: string
): Promise<string> => {
  // Create kind:24242 event template
  const eventTemplate = {
    kind: 24242,
    content: 'Authorize upload',
    tags: [
      ['t', 'upload'],
      ['x', sha256Hash],
      ['expiration', (Math.floor(Date.now() / 1000) + 300).toString()], // Valid for 5 minutes
    ],
  }

  // Sign event
  const signed = await signEvent(eventTemplate)
  const jsonString = JSON.stringify(signed)
  
  // Base64 encode the stringified JSON event
  const base64Token = btoa(unescape(encodeURIComponent(jsonString)))
  return `Nostr ${base64Token}`
}

// Upload a blob to a configured Blossom server
export const uploadToBlossom = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  blob: Blob,
  serverUrl: string
): Promise<{ url: string; sha256: string }> => {
  const sha256 = await calculateSha256(blob)
  
  // Clean up server URL trailing slash
  const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl
  const uploadUrl = `${baseUrl}/upload`

  console.log(`Hashing complete. SHA-256: ${sha256}`)
  const authHeader = await generateBlossomAuthHeader(signEvent, sha256, baseUrl)

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
