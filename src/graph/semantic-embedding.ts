import { FeatureHashEmbedding, VectorIndex, cosineSimilarity } from '@0xx0lostcause0xx0/polypack'
import { graph } from './polygraph'
import type { VideoShape } from '../nostr/cache'

export const SEMANTIC_EMBEDDING_VERSION = 'minilm-l6-v2-384-v1'
export const SEMANTIC_EMBEDDING_DIMENSIONS = 384
export const SEMANTIC_CORPUS_MAX = 500
export const SEMANTIC_IDLE_TTL_MS = 60_000
const FALLBACK_VERSION = 'feature-hash-384-v1'
const MODEL = 'onnx-community/all-MiniLM-L6-v2-ONNX'

export type SemanticVideoDocument = {
  id: string
  title?: string
  summary?: string
  hashtags?: string[]
  authorName?: string
}

type EmbeddingProvider = {
  version: string
  dimensions: number
  embed(text: string): Promise<Float64Array>
}

const fallback = new FeatureHashEmbedding({ dimensions: SEMANTIC_EMBEDDING_DIMENSIONS })
const transientIndex = new VectorIndex(undefined, cosineSimilarity)
const transientInputHashes = new Map<string, string>()
let transientProvider: EmbeddingProvider | null = null
let worker: Worker | null = null
let nextRequestId = 0
let semanticGeneration = 0
let idleTimer: ReturnType<typeof setTimeout> | null = null
const pending = new Map<number, { resolve: (v: Float64Array) => void; reject: (e: Error) => void }>()
let semanticProviderPromise: Promise<EmbeddingProvider | null> | null = null

export function videoEmbeddingText(video: Pick<SemanticVideoDocument, 'title' | 'summary' | 'hashtags' | 'authorName'>): string {
  return [
    video.title ? `Title: ${video.title}` : '',
    video.summary ? `Description: ${video.summary}` : '',
    video.hashtags?.length ? `Topics: ${video.hashtags.join(', ')}` : '',
    video.authorName ? `Creator: ${video.authorName}` : '',
  ].filter(Boolean).join('\n') || 'video'
}

function hashText(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function terminateSemanticWorker(reason = 'Semantic embedding worker disposed'): void {
  worker?.terminate()
  worker = null
  const error = new Error(reason)
  for (const request of pending.values()) request.reject(error)
  pending.clear()
}

function createWorkerProvider(device: 'wasm' | 'webgpu'): EmbeddingProvider {
  if (typeof Worker === 'undefined') throw new Error('Web Workers are unavailable')
  terminateSemanticWorker('Semantic embedding provider replaced')
  const nextWorker = new Worker(new URL('./embedding.worker.ts', import.meta.url), { type: 'module' })
  worker = nextWorker
  nextWorker.onmessage = ({ data }: MessageEvent<{ id: number; vector?: number[]; error?: string }>) => {
    const request = pending.get(data.id)
    if (!request) return
    pending.delete(data.id)
    if (data.error || !data.vector) request.reject(new Error(data.error ?? 'No embedding returned'))
    else request.resolve(new Float64Array(data.vector))
  }
  nextWorker.onerror = () => {
    const error = new Error('Browser embedding worker failed')
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }
  return {
    version: `transformers:${MODEL}:${device}`,
    dimensions: SEMANTIC_EMBEDDING_DIMENSIONS,
    embed: (text) => new Promise((resolve, reject) => {
      const id = ++nextRequestId
      pending.set(id, { resolve, reject })
      nextWorker.postMessage({ id, text, model: MODEL, device })
    }),
  }
}

function refreshIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => disposeSemanticEmbeddings(), SEMANTIC_IDLE_TTL_MS)
}

async function loadSemanticProvider(): Promise<EmbeddingProvider | null> {
  if (transientProvider) return transientProvider
  if (semanticProviderPromise) return semanticProviderPromise
  semanticProviderPromise = (async () => {
    const devices: Array<'wasm' | 'webgpu'> =
      typeof navigator !== 'undefined' && 'gpu' in navigator ? ['webgpu', 'wasm'] : ['wasm']
    for (const device of devices) {
      try {
        const candidate = createWorkerProvider(device)
        await candidate.embed('semantic search warmup')
        transientProvider = candidate
        return candidate
      } catch (error) {
        console.warn(`[SemanticSearch] ${device} provider unavailable`, error)
        terminateSemanticWorker()
      }
    }
    return null
  })()
  return semanticProviderPromise
}

/** Load MiniLM lazily and index only the caller's current, bounded corpus. */
export async function enableSemanticEmbeddings(corpus: SemanticVideoDocument[] = []): Promise<boolean> {
  const candidate = await loadSemanticProvider()
  if (!candidate) return false

  const generation = semanticGeneration
  const boundedCorpus = corpus.slice(0, SEMANTIC_CORPUS_MAX)
  const keepIds = new Set(boundedCorpus.map(({ id }) => id))
  for (const [id] of transientIndex.entries()) {
    if (!keepIds.has(id)) {
      transientIndex.remove(id)
      transientInputHashes.delete(id)
    }
  }

  for (const video of boundedCorpus) {
    if (generation !== semanticGeneration || transientProvider !== candidate) return false
    const text = videoEmbeddingText(video)
    const inputHash = hashText(text)
    if (transientInputHashes.get(video.id) === inputHash) continue
    const vector = await candidate.embed(text)
    transientIndex.add(video.id, vector)
    transientInputHashes.delete(video.id)
    transientInputHashes.set(video.id, inputHash)
    refreshIdleTimer()
  }
  refreshIdleTimer()
  return true
}

/** Release the model worker and every model-space vector. Safe to call repeatedly. */
export function disposeSemanticEmbeddings(): void {
  semanticGeneration += 1
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  terminateSemanticWorker()
  transientProvider = null
  semanticProviderPromise = null
  transientIndex.clear()
  transientInputHashes.clear()
}

/** Durable embeddings always use the cheap deterministic feature-hash space. */
export async function embedVideo(video: VideoShape): Promise<{ vector: Float64Array; version: string; inputHash: string }> {
  const text = videoEmbeddingText(video)
  return { vector: await fallback.embed(text), version: FALLBACK_VERSION, inputHash: hashText(text) }
}

export async function indexVideoEmbedding(video: VideoShape): Promise<void> {
  const { vector } = await embedVideo(video)
  graph.vectors.add(video.id, vector)
  graph.markVectorDirty(video.id)
}

export async function reindexVideoEmbeddings(): Promise<void> {
  const nodes = graph.whereType('video_shape')
  for (const node of nodes) {
    const video = node.data as unknown as VideoShape
    if (video.videoUrl && !video.hidden) await indexVideoEmbedding(video)
  }
}

export async function semanticSearchVideos(query: string, topK = 50): Promise<string[]> {
  if (transientProvider && transientIndex.size > 0) {
    refreshIdleTimer()
    try {
      const queryVector = await transientProvider.embed(query)
      return transientIndex.query([...queryVector], topK).map(({ id }) => id)
    } catch (error) {
      console.warn('[SemanticSearch] MiniLM query failed; using local fallback', error)
      disposeSemanticEmbeddings()
    }
  }

  const queryVector = await fallback.embed(query)
  const results = graph.vectors.query([...queryVector], topK + 50)
  return results
    .filter(({ id }) => graph.getNode(`shp:${id}`)?.type === 'video_shape')
    .slice(0, topK)
    .map(({ id }) => id)
}

/** Test/diagnostic snapshot without exposing mutable index internals. */
export function semanticEmbeddingStats(): { provider: string | null; transientVectors: number; pendingRequests: number } {
  return {
    provider: transientProvider?.version ?? null,
    transientVectors: transientIndex.size,
    pendingRequests: pending.size,
  }
}
