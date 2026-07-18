import { useGraphQuery as libUseGraphQuery, useLiveQuery as libUseLiveQuery } from '@0xx0lostcause0xx0/polypack/react'
import { graph } from './polygraph'
import type { NodeType } from './types'

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
