export { PolyGraph } from '@0xx0lostcause0xx0/polypack'
export { computeEventVector } from './vector-index'
export { VectorIndex, cosineSimilarity } from '@0xx0lostcause0xx0/polypack'
export { PolyPersistence } from './persistence'
export { GraphQuery } from '@0xx0lostcause0xx0/polypack'
export { useGraphQuery, useLiveQuery } from '@0xx0lostcause0xx0/polypack/react'
export { findSimilarVideos, findVideosSimilarToAuthor } from './similar'
export { findThread } from './threads'
export { ScrollstrGraph } from './scrollstr-graph'
export type * from './types'

import type { PolyNode } from './types'
import { ScrollstrGraph } from './scrollstr-graph'

export const graph = new ScrollstrGraph()
