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

  console.log(`Uploading file to Blossom server at ${uploadUrl}...`)
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
    throw new Error(`Blossom upload failed with status ${response.status}: ${errorText}`)
  }

  // Blossom BUD-01 returns a Descriptor object containing "url" and "sha256"
  const descriptor = await response.json()
  return {
    url: descriptor.url || `${baseUrl}/${sha256}`,
    sha256,
  }
}

// Upload a blob to a NIP-96 compliant server
export const uploadToNip96 = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  blob: Blob,
  serverUrl: string,
  nip96ApiUrl: string
): Promise<{ url: string; sha256: string }> => {
  const sha256 = await calculateSha256(blob)

  // Construct NIP-98 HTTP Auth event template
  const eventTemplate = {
    kind: 27235,
    content: '',
    tags: [
      ['u', nip96ApiUrl],
      ['method', 'POST'],
    ],
  }

  const signed = await signEvent(eventTemplate)
  const base64Token = btoa(unescape(encodeURIComponent(JSON.stringify(signed))))

  const formData = new FormData()
  formData.append('file', blob)

  console.log(`Uploading file to NIP-96 api endpoint at ${nip96ApiUrl}...`)
  const response = await fetch(nip96ApiUrl, {
    method: 'POST',
    body: formData,
    headers: {
      'Authorization': `Nostr ${base64Token}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`NIP-96 upload failed with status ${response.status}: ${errorText}`)
  }

  const result = await response.json()
  
  // Find URL in nip94_event tags
  let url = ''
  if (result.nip94_event && result.nip94_event.tags) {
    const urlTag = result.nip94_event.tags.find((t: any) => t[0] === 'url')
    if (urlTag) {
      url = urlTag[1]
    }
  }
  
  // Fallbacks
  if (!url) {
    url = result.url || ''
  }

  if (!url) {
    throw new Error('NIP-96 server did not return a valid download URL')
  }

  return { url, sha256 }
}

// Unified media upload helper that auto-detects between Blossom and NIP-96
export const uploadMedia = async (
  signEvent: (eventTemplate: any) => Promise<any>,
  blob: Blob,
  serverUrl: string
): Promise<{ url: string; sha256: string }> => {
  const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl

  // Try NIP-96 capability discovery
  try {
    const nip96ConfigUrl = `${baseUrl}/.well-known/nostr/nip96.json`
    console.log(`Checking NIP-96 configuration at ${nip96ConfigUrl}...`)
    const res = await fetch(nip96ConfigUrl, { method: 'GET' })
    if (res.ok) {
      const config = await res.json()
      if (config && config.api_url) {
        console.log(`NIP-96 API detected: ${config.api_url}`)
        return await uploadToNip96(signEvent, blob, baseUrl, config.api_url)
      }
    }
  } catch (err) {
    console.log(`Server ${baseUrl} does not support NIP-96 config, falling back to Blossom:`, err)
  }

  // Fallback to Blossom
  return await uploadToBlossom(signEvent, blob, baseUrl)
}
