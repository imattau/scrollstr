import {
  FeatureHashEmbedding,
  cosineSimilarity,
} from '@0xx0lostcause0xx0/polypack'
import { graph } from './polygraph'
import type { VideoShape } from '../nostr/cache'

export const SEMANTIC_EMBEDDING_VERSION = 'minilm-l6-v2-384-v1'
export const SEMANTIC_EMBEDDING_DIMENSIONS = 384
const MODEL = 'onnx-community/all-MiniLM-L6-v2-ONNX'

type EmbeddingProvider = {
  version: string
  dimensions: number
  embed(text: string): Promise<Float64Array>
}

const fallback = new FeatureHashEmbedding({ dimensions: SEMANTIC_EMBEDDING_DIMENSIONS })
let provider: EmbeddingProvider = {
  version: 'feature-hash-384-v1',
  dimensions: fallback.dimensions,
  embed: async (text) => fallback.embed(text),
}
let worker: Worker | null = null
let nextRequestId = 0
const pending = new Map<number, { resolve: (v: Float64Array) => void; reject: (e: Error) => void }>()
let semanticProviderPromise: Promise<boolean> | null = null

export function videoEmbeddingText(video: Pick<VideoShape, 'title' | 'summary' | 'hashtags' | 'authorName'>): string {
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

function createWorkerProvider(device: 'wasm' | 'webgpu'): EmbeddingProvider {
  if (typeof Worker === 'undefined') throw new Error('Web Workers are unavailable')
  worker = new Worker(new URL('./embedding.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = ({ data }: MessageEvent<{ id: number; vector?: number[]; error?: string }>) => {
    const request = pending.get(data.id)
    if (!request) return
    pending.delete(data.id)
    if (data.error || !data.vector) request.reject(new Error(data.error ?? 'No embedding returned'))
    else request.resolve(new Float64Array(data.vector))
  }
  worker.onerror = () => {
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
      worker!.postMessage({ id, text, model: MODEL, device })
    }),
  }
}

/** Try WebGPU, then WASM. Failure leaves the deterministic local provider active. */
export async function enableSemanticEmbeddings(): Promise<boolean> {
  if (provider.version.startsWith('transformers:')) return true
  if (semanticProviderPromise) return semanticProviderPromise
  semanticProviderPromise = (async () => {
    const devices: Array<'wasm' | 'webgpu'> =
      typeof navigator !== 'undefined' && 'gpu' in navigator ? ['webgpu', 'wasm'] : ['wasm']
    for (const device of devices) {
      try {
        const candidate = createWorkerProvider(device)
        await candidate.embed('semantic search warmup')
        provider = candidate
        await reindexVideoEmbeddings()
        return true
      } catch (error) {
        console.warn(`[SemanticSearch] ${device} provider unavailable`, error)
        worker?.terminate()
        worker = null
        provider = {
          version: 'feature-hash-384-v1',
          dimensions: fallback.dimensions,
          embed: async (text) => fallback.embed(text),
        }
      }
    }
    // Ensure pre-existing cached shapes also have a compatible vector when
    // the model cannot load. This keeps the offline fallback searchable.
    await reindexVideoEmbeddings()
    return false
  })()
  return semanticProviderPromise
}

export async function embedVideo(video: VideoShape): Promise<{ vector: Float64Array; version: string; inputHash: string }> {
  const text = videoEmbeddingText(video)
  return { vector: await provider.embed(text), version: provider.version, inputHash: hashText(text) }
}

export async function indexVideoEmbedding(video: VideoShape): Promise<void> {
  const { vector, version, inputHash } = await embedVideo(video)
  graph.vectors.add(video.id, vector)
  graph.markVectorDirty(video.id)
  // The vector itself is persisted by Polypack. Keep the input metadata in
  // the shape payload when it is created; avoid a metadata-only update here,
  // since older cached nodes may lack Polypack provenance fields required by
  // newer update validation.
}

export async function reindexVideoEmbeddings(): Promise<void> {
  const nodes = graph.whereType('video_shape')
  for (const node of nodes) {
    const video = node.data as unknown as VideoShape
    if (video.videoUrl && !video.hidden) await indexVideoEmbedding(video)
  }
}

export async function semanticSearchVideos(query: string, topK = 50): Promise<string[]> {
  const queryVector = await provider.embed(query)
  const vectors = await graph.persistence.getAllVectors()
  return vectors
    .filter(({ vector }) => vector.length === queryVector.length)
    .map(({ id, vector }) => ({ id, score: cosineSimilarity(queryVector, vector) }))
    .filter(({ id }) => graph.getNode(`shp:${id}`)?.type === 'video_shape')
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ id }) => id)
}
