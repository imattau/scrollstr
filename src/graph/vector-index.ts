import type { PolyNode } from './types'

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

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

export class VectorIndex {
  private vectors = new Map<string, number[]>()
  private onChange?: (id: string) => void

  constructor(onChange?: (id: string) => void) {
    this.onChange = onChange
  }

  add(id: string, vector: number[]): void {
    this.vectors.set(id, vector)
    this.onChange?.(id)
  }

  remove(id: string): void {
    this.vectors.delete(id)
  }

  query(
    vector: number[],
    topK: number,
    threshold = 0
  ): Array<{ id: string; score: number }> {
    const results: Array<{ id: string; score: number }> = []
    for (const [id, v] of this.vectors) {
      const score = cosineSimilarity(vector, v)
      if (score < threshold) continue
      results.push({ id, score })
    }
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  clear(): void {
    this.vectors.clear()
  }

  get size(): number {
    return this.vectors.size
  }

  entries(): IterableIterator<[string, number[]]> {
    return this.vectors.entries()
  }

  has(id: string): boolean {
    return this.vectors.has(id)
  }

  get(id: string): number[] | undefined {
    return this.vectors.get(id)
  }
}
