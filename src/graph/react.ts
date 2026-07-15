import { useEffect, useRef, useState, useCallback } from 'react'
import { graph } from './polygraph'
import type { NodeType } from './types'

/** Drop-in replacement for dexie-react-hooks' useLiveQuery */
export function useLiveQuery<T>(
  querier: () => Promise<T> | T,
  deps?: any[],
  defaultResult?: T
): T | undefined {
  const result = useGraphQuery(querier, deps ?? [])
  return result ?? defaultResult
}

/**
 * React hook that subscribes to graph.changes and re-runs `queryFn` on every
 * emission. When `nodeTypes` is provided, only re-runs for change events whose
 * `nodeType` matches (or for the bulk warm event which has no nodeType).
 * This reduces cascading re-renders when a graph change affects unrelated
 * node types.
 */
export function useGraphQuery<T>(
  queryFn: () => T | Promise<T>,
  deps: unknown[],
  delay = 200,
  nodeTypes?: NodeType[],
): T | undefined {
  const [result, setResult] = useState<T | undefined>(undefined)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mountedRef = useRef(true)
  const isFirstRef = useRef(true)
  const nodeTypesRef = useRef(nodeTypes)
  const queryInFlightRef = useRef(false)
  const rerunPendingRef = useRef(false)
  const queryEpochRef = useRef({})
  const runQueryRef = useRef<() => void>(() => {})

  useEffect(() => {
    nodeTypesRef.current = nodeTypes
  }, [nodeTypes])

  const runQuery = useCallback(() => {
    const epoch = queryEpochRef.current

    if (queryInFlightRef.current) {
      rerunPendingRef.current = true
      return
    }

    queryInFlightRef.current = true

    const finishQuery = () => {
      queryInFlightRef.current = false
      if (rerunPendingRef.current && mountedRef.current) {
        rerunPendingRef.current = false
        runQueryRef.current()
      }
    }

    try {
      const value = queryFn()
      const setValue = (resolved: T) => {
        if (epoch !== queryEpochRef.current) return
        if (isFirstRef.current) {
          isFirstRef.current = false
          if (mountedRef.current) setResult(resolved)
        } else {
          clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => {
            if (mountedRef.current) setResult(resolved)
          }, delay)
        }
      }
      if (value instanceof Promise) {
        value
          .then(setValue)
          .catch((err) => {
            if (epoch !== queryEpochRef.current) return
            console.error('[Graph] Query error:', err)
            if (mountedRef.current) setResult(undefined)
          })
          .finally(finishQuery)
      } else {
        setValue(value)
        finishQuery()
      }
    } catch (err) {
      console.error('[Graph] Query error:', err)
      if (mountedRef.current) setResult(undefined)
      finishQuery()
    }
  // This hook intentionally accepts a caller-provided dependency list.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
  }, deps)

  useEffect(() => {
    runQueryRef.current = runQuery
  }, [runQuery])

  useEffect(() => {
    mountedRef.current = true
    isFirstRef.current = true

    runQuery()

    const types = nodeTypesRef.current
    const subscription = graph.changes.subscribe((event) => {
      if (types && event.nodeType && !types.includes(event.nodeType)) {
        return
      }
      runQuery()
    })

    return () => {
      mountedRef.current = false
      queryEpochRef.current = {}
      rerunPendingRef.current = false
      clearTimeout(timerRef.current)
      subscription.unsubscribe()
    }
  }, [runQuery])

  return result
}
