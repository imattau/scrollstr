import React, { useEffect, useMemo } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import { Heart, MessageCircle, Repeat2, Zap, UserPlus } from 'lucide-react'
import { useNostr } from '../../app/providers'
import { subscribeToRelays } from '../../nostr/pool'
import { useUserRelayUrls } from '../../nostr/relays'
import { db } from '../../nostr/cache'
import { useLiveQuery } from '../../graph'
import { useProfile } from '../../nostr/profile'
import { useNavigate } from 'react-router-dom'

const EMPTY_EVENTS: any[] = []
const VIDEO_KINDS = [21, 22, 34236]
const REACTION_KINDS = [7, 16, 1111, 9735]

const ActivityRow: React.FC<{ event: any }> = ({ event }) => {
  const navigate = useNavigate()

  // Resolve actual sender and notification details
  const parsed = useMemo(() => {
    let type: 'like' | 'boost' | 'comment' | 'zap' = 'like'
    let authorPubkey = event.pubkey
    let details = ''

    if (event.kind === 7) {
      type = 'like'
      details = 'liked your video'
    } else if (event.kind === 6 || event.kind === 16) {
      type = 'boost'
      details = 'boosted your video'
    } else if (event.kind === 1 || event.kind === 1111) {
      type = 'comment'
      details = `commented: “${event.content.slice(0, 36)}${event.content.length > 36 ? '...' : ''}”`
    } else if (event.kind === 9735) {
      type = 'zap'
      let sats = 0
      const descTag = event.tags.find((t: any) => t[0] === 'description')
      if (descTag) {
        try {
          const parsedReq = JSON.parse(descTag[1])
          authorPubkey = parsedReq.pubkey
          const amountTag = parsedReq.tags.find((t: any) => t[0] === 'amount')
          if (amountTag) {
            sats = Math.round(parseInt(amountTag[1]) / 1000)
          }
        } catch (error) {
          console.warn('Failed to parse zap description tag:', error)
        }
      }
      details = sats > 0 ? `zapped you ${sats} sats` : 'zapped your video'
    }

    return { type, authorPubkey, details }
  }, [event])

  const profile = useProfile(parsed.authorPubkey)
  const displayName = profile.displayName || profile.name || 'Nostr User'
  const avatarInitial = displayName.slice(0, 1).toUpperCase() || 'N'

  const icon = useMemo(() => {
    switch (parsed.type) {
      case 'like':
        return <Heart className="h-4 w-4 text-red-500 fill-red-500" />
      case 'boost':
        return <Repeat2 className="h-4 w-4 text-green-500" />
      case 'comment':
        return <MessageCircle className="h-4 w-4 text-blue-500 fill-blue-500" />
      case 'zap':
        return <Zap className="h-4 w-4 text-[#f5b942] fill-[#f5b942]" />
    }
  }, [parsed.type])

  return (
    <div className="flex items-center gap-3 py-3 border-b border-[#23232a]/30 px-2 hover:bg-[#111115]/30 rounded-xl transition-colors">
      <div
        className="flex size-[40px] overflow-hidden shrink-0 items-center justify-center rounded-full bg-[#18181d] cursor-pointer"
        onClick={() => navigate(`/profile/${parsed.authorPubkey}`)}
      >
        {profile.picture ? (
          <img src={profile.picture} alt={displayName} className="h-full w-full object-cover" />
        ) : (
          <span className="text-[14px] font-bold text-[#a78bfa]">{avatarInitial}</span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-[#f7f7f8] leading-tight">
          <span
            className="font-bold cursor-pointer hover:underline text-[#a78bfa]"
            onClick={() => navigate(`/profile/${parsed.authorPubkey}`)}
          >
            @{displayName}
          </span>{' '}
          {parsed.details}
        </p>
        <p className="text-[10px] text-[#71717a] mt-0.5">{formatDistanceToNowStrict(event.created_at * 1000, { addSuffix: true })}</p>
      </div>

      <div className="flex size-[28px] items-center justify-center rounded-full bg-[#18181d] shrink-0">
        {icon}
      </div>
    </div>
  )
}

export const ActivityPage: React.FC = () => {
  const { session, pool } = useNostr()
  const userPubkey = session?.pubkey
  const navigate = useNavigate()
  const relayUrls = useUserRelayUrls(userPubkey)

  // Subscribe to the user's own video events so the cache has them
  useEffect(() => {
    if (!userPubkey) return
    const unsub = subscribeToRelays(relayUrls, {
      kinds: VIDEO_KINDS,
      authors: [userPubkey],
      limit: 100,
    })
    return () => unsub()
  }, [userPubkey, relayUrls])

  // Query the user's video events from Dexie cache
  const rawUserVideos = useLiveQuery(
    () => userPubkey
      ? db.cachedEvents
          .where('pubkey')
          .equals(userPubkey)
          .filter(e => e.kind === 21 || e.kind === 22 || e.kind === 34236)
          .toArray()
      : Promise.resolve([] as any[]),
    [userPubkey]
  ) ?? EMPTY_EVENTS

  // Deduped array of the user's video event IDs
  const dedupedVideoIds = useMemo(
    () => [...new Set(rawUserVideos.map((ev: any) => ev.id))],
    [rawUserVideos]
  )

  // Stable key to avoid unnecessary effect re-runs
  const videoIdsKey = useMemo(
    () => (dedupedVideoIds.length > 0 ? dedupedVideoIds.join(',') : null),
    [dedupedVideoIds]
  )

  // Query reactions/comments referencing those videos from Dexie cache
  const rawEvents = useLiveQuery(
    () => {
      const ids = videoIdsKey ? videoIdsKey.split(',') : []
      if (ids.length === 0) return Promise.resolve([] as any[])
      return db.cachedEvents
        .where('eTags')
        .anyOf(ids)
        .filter(e => REACTION_KINDS.includes(e.kind))
        .toArray()
    },
    [videoIdsKey]
  ) ?? EMPTY_EVENTS

  // Live subscription for reactions/comments on the user's videos
  useEffect(() => {
    if (!userPubkey || !videoIdsKey) return
    const ids = videoIdsKey.split(',')
    const sub = subscribeToRelays(relayUrls, {
      kinds: REACTION_KINDS,
      '#e': ids,
      limit: 50,
    })
    return () => { sub() }
  }, [userPubkey, relayUrls, videoIdsKey])

  // Sort and filter events — safety net: only show events referencing known video IDs
  const sortedEvents = useMemo(() => {
    const videoIdSet = new Set(dedupedVideoIds)
    return [...rawEvents]
      .filter((ev: any) => {
        const eTag = ev.event?.tags?.find((t: any) => t[0] === 'e')
        return eTag && videoIdSet.has(eTag[1])
      })
      .sort((a: any, b: any) => b.created_at - a.created_at)
      .map((ev: any) => ev.event)
  }, [rawEvents, dedupedVideoIds])

  if (!session) {
    return (
      <div className="flex min-h-full flex-col bg-[#09090b] px-4 pb-4 pt-4 text-[#f7f7f8] items-center justify-center">
        <p className="text-[14px] text-[#a1a1aa] mb-4">Please log in to view your activity feed.</p>
        <button
          onClick={() => navigate('/')}
          className="rounded-[11px] bg-[#8b5cf6] px-4 py-2 text-[13px] font-semibold text-white"
        >
          Go to Feed
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col bg-[#09090b] px-4 pb-4 pt-4 text-[#f7f7f8]">
      <div className="flex h-[56px] items-center">
        <h2 className="text-[18px] font-bold">Activity</h2>
      </div>

      <div className="flex flex-1 flex-col gap-1 pb-16 md:pb-4">
        {sortedEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-[#71717a] text-center">
            <p className="text-[14px] font-medium">No activity yet.</p>
            <p className="text-[12px] mt-1">Interactions on your posts will appear here.</p>
          </div>
        ) : (
          sortedEvents.map((event) => <ActivityRow key={event.id} event={event} />)
        )}
      </div>
    </div>
  )
}
