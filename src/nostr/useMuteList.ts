import { useEffect, useMemo, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, pruneBlockedContent } from './cache'
import { subscribeToRelays } from './pool'
import { useUserRelayUrls } from './relays'

export function useMuteList(sessionPubkey?: string | null): {
  mutedPubkeys: Set<string>
  mutedHashtags: Set<string>
} {
  const relayUrls = useUserRelayUrls(sessionPubkey)

  const muteListEvents = useLiveQuery(
    () => sessionPubkey
      ? db.cachedEvents.where({ kind: 10000, pubkey: sessionPubkey }).toArray()
      : Promise.resolve([] as any[]),
    [sessionPubkey]
  ) ?? []

  const muteListEvent = muteListEvents.toSorted((a, b) => b.created_at - a.created_at)[0]?.event

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
