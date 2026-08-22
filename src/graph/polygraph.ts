export { PolyGraph } from '@0xx0lostcause0xx0/polypack'
export { computeEventVector } from './vector-index'
export { VectorIndex, cosineSimilarity } from '@0xx0lostcause0xx0/polypack'
export { PolyPersistence } from './persistence'
export { GraphQuery } from '@0xx0lostcause0xx0/polypack'
export { findSimilarVideos, findVideosSimilarToAuthor } from './similar'
export { semanticSearchVideos, reindexVideoEmbeddings } from './semantic-embedding'
export { findThread } from './threads'
export { ScrollstrGraph } from './scrollstr-graph'
export type * from './types'

import type { PolyNode } from './types'
import type { PersistenceAdapter } from '@0xx0lostcause0xx0/polypack'
import { ScrollstrGraph } from './scrollstr-graph'

export const graph = new ScrollstrGraph()

export async function swapGraphPersistence(adapter: PersistenceAdapter): Promise<void> {
  try { await graph.persistence.close() } catch { /* ignore close errors */ }
  Object.defineProperty(graph, 'persistence', { value: adapter, writable: true, configurable: true })
}
