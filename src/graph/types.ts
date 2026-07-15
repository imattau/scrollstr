export type EdgeOwnership = 'owned' | 'shared' | 'derived' | 'reference'

export type NodeType =
  | 'event'
  | 'video_shape'
  | 'profile'
  | 'media'
  | 'hashtag'
  | 'counter'
  | 'rejection'
  | 'user_state'
  | 'relay'

export interface PolyNode {
  id: string
  type: NodeType
  data: Record<string, unknown>
  vector?: Float64Array
  insertedAt: number
  updatedAt: number
}

export type EdgeType =
  | 'AUTHORED_BY'
  | 'REFERENCES'
  | 'MENTIONS'
  | 'TAGGED_WITH'
  | 'HAS_MEDIA'
  | 'HAS_COUNTER'
  | 'HAS_STATE'
  | 'HAS_REJECTION'
  | 'OBSERVED_ON'
  | 'AUTHORED_ON'

/** Default ownership class per EdgeType. Most edges of a given type share the
 *  same semantics — individual edges can override via `data.__ownership`. */
export const EDGE_OWNERSHIP: Record<EdgeType, EdgeOwnership> = {
  AUTHORED_BY: 'reference',
  REFERENCES: 'reference',
  MENTIONS: 'reference',
  TAGGED_WITH: 'reference',
  HAS_MEDIA: 'shared',
  HAS_COUNTER: 'owned',
  HAS_STATE: 'owned',
  HAS_REJECTION: 'owned',
  OBSERVED_ON: 'reference',
  AUTHORED_ON: 'derived',
}

export interface PolyEdge {
  id: string
  source: string
  target: string
  type: EdgeType
  data?: Record<string, unknown>
  createdAt: number
}

export interface QueryOptions {
  nodeTypes?: NodeType[]
  attributes?: Record<string, unknown>
  attributeRanges?: Record<string, { above?: number; below?: number }>
  edgeType?: EdgeType
  edgeTarget?: string
  edgeSource?: string
  orderBy?: { field: string; direction: 'asc' | 'desc' }
  limit?: number
  offset?: number
}

export interface VectorQuery {
  vector: number[]
  threshold?: number
  topK: number
}

export interface GraphChangeEvent {
  type: 'node_added' | 'node_updated' | 'node_removed' | 'edge_added' | 'edge_removed'
  nodeId?: string
  nodeType?: NodeType
  edgeId?: string
  edgeType?: EdgeType
  source?: string
  target?: string
}

export interface SerializedNode {
  id: string
  type: NodeType
  data: Record<string, unknown>
  vector: number[] | null
  insertedAt: number
  updatedAt: number
  /** For replaceable Nostr events (kind 0, 3, 10002, and NIP-33 range):
   *  `${kind}:${pubkey}[:${dTag}]`. Used by the `by_replaceable` IDB index
   *  so putReplaceable can find and overwrite older versions. */
  replaceableKey?: string
}

export interface SerializedEdge {
  id: string
  source: string
  target: string
  type: EdgeType
  data: Record<string, unknown> | null
  createdAt: number
}
