import { useEffect, useMemo, useRef } from 'react'
import { graph, useGraphQuery } from '../graph'
import { pruneBlockedContent } from './cache'
import { subscribeToRelays } from './pool'
import { useUserRelayUrls } from './relays'

export function useMuteList(sessionPubkey?: string | null): {
  mutedPubkeys: Set<string>
  mutedHashtags: Set<string>
} {
  const relayUrls = useUserRelayUrls(sessionPubkey)

  const muteListEvent = useGraphQuery(
    () => {
      if (!sessionPubkey) return undefined
      const node = graph.byKindPubkey(10000, sessionPubkey)
      return (node?.data as any)?.event as { tags: string[][] } | undefined
    },
    [sessionPubkey],
    200,
    ['event'],
  )

  const mutedPubkeys = useMemo(
    () => new Set<string>(
      (muteListEvent?.tags ?? [])
        .filter((t: any) => t[0] === 'p')
        .map((t: any) => t[1])
    ),
    [muteListEvent]
  )
  const mutedHashtags = useMemo(
    () => new Set<string>(
      (muteListEvent?.tags ?? [])
        .filter((t: any) => t[0] === 't')
        .map((t: any) => t[1])
    ),
    [muteListEvent]
  )

  const prevPubkeysRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    const prev = prevPubkeysRef.current
    if (prev === null) {
      prevPubkeysRef.current = new Set(mutedPubkeys)
      return
    }

    const newlyBlocked: string[] = []
    for (const pk of mutedPubkeys) {
      if (!prev.has(pk)) newlyBlocked.push(pk)
    }
    prevPubkeysRef.current = new Set(mutedPubkeys)

    if (newlyBlocked.length > 0) {
      void pruneBlockedContent(newlyBlocked)
    }
  }, [mutedPubkeys])

  useEffect(() => {
    if (!sessionPubkey || !relayUrls.length) return
    const unsub = subscribeToRelays(relayUrls, {
      kinds: [10000],
      authors: [sessionPubkey],
      limit: 1,
    })
    return () => unsub()
  }, [sessionPubkey, relayUrls])

  return { mutedPubkeys, mutedHashtags }
}
