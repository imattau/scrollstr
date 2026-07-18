export { VectorIndex, cosineSimilarity } from '@0xx0lostcause0xx0/polypack'

export function computeEventVector(event: {
  kind: number
  pubkey: string
  created_at: number
  eTagsCount: number
  pTagsCount: number
  hashtags: string[]
}): number[] {
  const hash32 = (s: string): number => {
    let h = 0
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0
    }
    return h >>> 0
  }

  const isVideo =
    event.kind === 1 || event.kind === 21 || event.kind === 22 || event.kind === 34236 ? 1 : 0
  const isReaction = [6, 7, 16, 9735, 1111].includes(event.kind) ? 1 : 0

  return [
    event.kind / 100000,
    hash32(event.pubkey) / 2 ** 32,
    event.created_at / 2_000_000_000,
    Math.min(event.eTagsCount, 50) / 50,
    Math.min(event.pTagsCount, 50) / 50,
    isVideo,
    isReaction,
  ]
}
