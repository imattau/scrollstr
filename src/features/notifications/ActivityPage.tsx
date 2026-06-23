import React, { useEffect, useMemo } from 'react'
import { Heart, MessageCircle, Repeat2, Zap, UserPlus } from 'lucide-react'
import { useNostr } from '../../app/providers'
import { getEventsQuery$, subscribeToRelays } from '../../nostr/pool'
import { useUserRelayUrls } from '../../nostr/relays'
import { use$ } from 'applesauce-react/hooks'
import { useProfile } from '../../nostr/profile'
import { useNavigate } from 'react-router-dom'

const EMPTY_EVENTS: any[] = []

const formatTime = (createdAt: number) => {
  const diff = Math.floor(Date.now() / 1000) - createdAt
  if (diff < 60) return 'now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

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
        <p className="text-[10px] text-[#71717a] mt-0.5">{formatTime(event.created_at)}</p>
      </div>

      <div className="flex size-[28px] items-center justify-center rounded-full bg-[#18181d] shrink-0">
        {icon}
      </div>
    </div>
  )
}

export const ActivityPage: React.FC = () => {
  const { session, rxNostr, eventStore } = useNostr()
  const userPubkey = session?.pubkey
  const navigate = useNavigate()
  const relayUrls = useUserRelayUrls(eventStore, userPubkey)

  // Query events targeting the user in EventStore
  const rawEvents = use$(
    () =>
      getEventsQuery$({
        kinds: [1, 6, 7, 16, 1111, 9735],
        '#p': userPubkey ? [userPubkey] : [],
      }),
    [userPubkey]
  ) ?? EMPTY_EVENTS

  // Subscribe to real-time events targeting user
  useEffect(() => {
    if (!userPubkey) return
    console.log(`Subscribing to Nostr activity events for ${userPubkey}...`)
    const sub = subscribeToRelays(relayUrls, {
      kinds: [1, 6, 7, 16, 1111, 9735],
      '#p': [userPubkey],
      limit: 50,
    })
    return () => {
      sub()
    }
  }, [userPubkey, relayUrls])

  // Sort and filter events to only include interactions referencing short-video events
  const sortedEvents = useMemo(() => {
    return [...rawEvents]
      .filter((ev) => {
        // Find the referenced event ID (e tag)
        const eTag = ev.tags.find((t: any) => t[0] === 'e')
        if (!eTag) return true // Let non-event targets (like follows) pass

        const parentEvent = eventStore.getByFilters({ ids: [eTag[1]] })[0]
        if (!parentEvent) return true // If parent event is not yet cached, show it as fallback

        return parentEvent.kind === 21 || parentEvent.kind === 22 || parentEvent.kind === 34236
      })
      .sort((a, b) => b.created_at - a.created_at)
  }, [rawEvents, eventStore])

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
