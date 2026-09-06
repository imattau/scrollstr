import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SEMANTIC_CORPUS_MAX,
  disposeSemanticEmbeddings,
  embedVideo,
  enableSemanticEmbeddings,
  semanticEmbeddingStats,
  semanticSearchVideos,
} from './semantic-embedding'

class FakeEmbeddingWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  terminate = vi.fn()

  postMessage(message: { id: number; text: string }): void {
    const vector = Array.from({ length: 384 }, (_, index) => index === 0 ? message.text.length : 1)
    queueMicrotask(() => this.onmessage?.({ data: { id: message.id, vector } } as MessageEvent))
  }
}

const originalWorker = globalThis.Worker

afterEach(() => {
  disposeSemanticEmbeddings()
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: originalWorker })
})

describe('semantic embedding lifecycle', () => {
  it('bounds MiniLM vectors to the caller-provided corpus and disposes them', async () => {
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeEmbeddingWorker })
    const corpus = Array.from({ length: SEMANTIC_CORPUS_MAX + 25 }, (_, index) => ({
      id: `video-${index}`,
      title: `Video ${index}`,
    }))

    expect(await enableSemanticEmbeddings(corpus)).toBe(true)
    expect(semanticEmbeddingStats().transientVectors).toBe(SEMANTIC_CORPUS_MAX)
    expect(await semanticSearchVideos('video', 10)).toHaveLength(10)

    disposeSemanticEmbeddings()
    expect(semanticEmbeddingStats()).toEqual({ provider: null, transientVectors: 0, pendingRequests: 0 })
  })

  it('keeps durable embeddings in feature-hash space after MiniLM is enabled', async () => {
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeEmbeddingWorker })
    await enableSemanticEmbeddings([{ id: 'candidate', title: 'Candidate' }])

    const result = await embedVideo({ id: 'durable', title: 'Durable', summary: 'hash me' } as any)
    expect(result.version).toBe('feature-hash-384-v1')
    expect(result.vector).toHaveLength(384)
    expect(result.vector[0]).not.toBe('Title: Durable\nDescription: hash me'.length)
  })
})
