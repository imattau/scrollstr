import type {
  PolyNode as LibPolyNode,
  PolyEdge as LibPolyEdge,
  EdgeOwnership as LibEdgeOwnership,
  GraphChangeEvent,
  SerializedNode,
  SerializedEdge,
  VectorQuery,
} from '@0xx0lostcause0xx0/polypack'

export type EdgeOwnership = LibEdgeOwnership

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

export type PolyNode<TData extends Record<string, unknown> = Record<string, unknown>> = LibPolyNode<TData>

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
  AUTHORED_ON: 'reference',
}

export type PolyEdge<TData extends Record<string, unknown> = Record<string, unknown>> = LibPolyEdge<TData>

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

export type { GraphChangeEvent, SerializedNode, SerializedEdge, VectorQuery }
