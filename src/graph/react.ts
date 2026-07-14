import { useEffect, useRef, useState, useCallback } from 'react'
import { graph } from './polygraph'

/** Drop-in replacement for dexie-react-hooks' useLiveQuery */
export function useLiveQuery<T>(
  querier: () => Promise<T> | T,
  deps?: any[],
  defaultResult?: T
): T | undefined {
  const result = useGraphQuery(querier, deps ?? [])
  return result ?? defaultResult
}

export function useGraphQuery<T>(
  queryFn: () => T | Promise<T>,
  deps: unknown[],
  delay = 200
): T | undefined {
  const [result, setResult] = useState<T | undefined>(undefined)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mountedRef = useRef(true)
  const isFirstRef = useRef(true)

  const runQuery = useCallback(() => {
    try {
      const value = queryFn()
      const setValue = (resolved: T) => {
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
        value.then(setValue).catch((err) => {
          console.error('[Graph] Query error:', err)
          if (mountedRef.current) setResult(undefined)
        })
      } else {
        setValue(value)
      }
    } catch (err) {
      console.error('[Graph] Query error:', err)
      if (mountedRef.current) setResult(undefined)
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current = true
    isFirstRef.current = true

    runQuery()

    const subscription = graph.changes.subscribe(() => {
      runQuery()
    })

    return () => {
      mountedRef.current = false
      clearTimeout(timerRef.current)
      subscription.unsubscribe()
    }
  }, [runQuery])

  return result
}
