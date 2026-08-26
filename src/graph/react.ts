import { useGraphQuery as libUseGraphQuery, useLiveQuery as libUseLiveQuery, useWorkingMemory as libUseWorkingMemory } from '@0xx0lostcause0xx0/polypack/react'
import { graph } from './polygraph'
import type { NodeType, PolyNode } from './types'

export function useLiveQuery<T>(
  querier: () => Promise<T> | T,
  deps?: unknown[],
  defaultResult?: T
): T | undefined {
  return libUseLiveQuery(graph, querier, deps ?? [], defaultResult)
}

export function useGraphQuery<T>(
  queryFn: () => T | Promise<T>,
  deps: unknown[],
  delay = 200,
  nodeTypes?: NodeType[],
): T | undefined {
  return libUseGraphQuery(graph, queryFn, deps, delay, nodeTypes as string[])
}

/**
 * Live view of the `limit` most-activated loaded nodes (Polypack's
 * `topActivated`), re-queried after graph mutations including
 * `activation_updated` events from `reinforceNode`/`reinforceNodeSafe`.
 */
export function useWorkingMemory(
  limit = 10,
  deps: unknown[] = [],
  nodeTypes?: NodeType[],
): PolyNode[] | undefined {
  return libUseWorkingMemory(graph, limit, deps, 200, nodeTypes as string[])
}
