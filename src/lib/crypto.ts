const ALGORITHM = 'AES-GCM'
const KEY_LENGTH = 256
const SESSION_KEY_STORAGE = 'scrollstr_encryption_key'

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

async function getOrCreateKey(): Promise<CryptoKey> {
  let storedKey = sessionStorage.getItem(SESSION_KEY_STORAGE)
  if (!storedKey) {
    const key = await crypto.subtle.generateKey(
      { name: ALGORITHM, length: KEY_LENGTH },
      true,
      ['encrypt', 'decrypt']
    )
    const exported = await crypto.subtle.exportKey('raw', key)
    storedKey = arrayBufferToBase64(exported)
    sessionStorage.setItem(SESSION_KEY_STORAGE, storedKey)
  }
  const keyData = base64ToArrayBuffer(storedKey)
  return await crypto.subtle.importKey('raw', keyData, ALGORITHM, false, ['encrypt', 'decrypt'])
}

export async function encryptValue(plaintext: string): Promise<string> {
  const key = await getOrCreateKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoded
  )
  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(ciphertext), iv.length)
  return arrayBufferToBase64(combined.buffer)
}

export function isInternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true
    if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return true
    const ipMatch = hostname.match(/^(\d+\.\d+\.\d+\.\d+)$/)
    if (ipMatch) {
      const ip = ipMatch[1]
      if (/^(?:127\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0)/.test(ip)) return true
    }
    return false
  } catch {
    return true
  }
}

export function isSafeVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export async function decryptValue(ciphertextB64: string): Promise<string> {
  const key = await getOrCreateKey()
  const combined = new Uint8Array(base64ToArrayBuffer(ciphertextB64))
  const iv = combined.slice(0, 12)
  const data = combined.slice(12)
  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    data
  )
  return new TextDecoder().decode(decrypted)
}
