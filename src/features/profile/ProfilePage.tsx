import React, { useState, useEffect, useMemo } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { MoreHorizontal, FileVideo, RotateCw, Info, Calendar, ArrowLeft } from 'lucide-react'
import { useParams, useNavigate } from 'react-router-dom'
import { useNostr } from '../../app/providers'
import { subscribeToRelays } from '../../nostr/pool'
import { db, saveEventToCache } from '../../nostr/cache'
import { useLiveQuery } from 'dexie-react-hooks'
import { parseVideoEvent, publishFollow, publishMuteList } from '../../nostr/events'
import { VideoItemData } from '../feed/VideoFeedItem'
import { useProfile } from '../../nostr/profile'
import { useUserRelayUrls } from '../../nostr/relays'

const EMPTY_VIDEOS: any[] = []
const EMPTY_EVENTS: any[] = []
const VIDEO_KINDS = [21, 22, 34236]

const CreatorListItem: React.FC<{
  pubkey: string
  isFollowing: boolean
  session: any
  onFollow: (pubkey: string) => void
}> = ({ pubkey, isFollowing, session, onFollow }) => {
  const navigate = useNavigate()
  const profile = useProfile(pubkey)
  const displayName = profile.displayName || profile.name || 'Nostr User'
  const avatarInitial = displayName.slice(0, 1).toUpperCase() || 'N'

  const rawVideoEvents: any[] = useLiveQuery(
    () => db.cachedEvents.where('pubkey').equals(pubkey).filter(e => VIDEO_KINDS.includes(e.kind)).toArray(),
    [pubkey]
  ) ?? []

  const videoCount = rawVideoEvents.length

  const color = useMemo(() => {
    const colors = ['#60a5fa', '#f05252', '#31c48d', '#a78bfa', '#f5b942']
    let hash = 0
    for (let i = 0; i < pubkey.length; i++) {
      hash = ((hash << 5) - hash) + pubkey.charCodeAt(i)
    }
    return colors[Math.abs(hash) % colors.length]
  }, [pubkey])

  return (
    <div className="flex items-center justify-between py-2">
      <div
        className="flex items-center gap-3 cursor-pointer"
        onClick={() => navigate(`/profile/${pubkey}`)}
      >
        <div
          className="flex size-[44px] overflow-hidden items-center justify-center rounded-full text-[15px] font-bold text-white shrink-0"
          style={{ backgroundColor: color }}
        >
          {profile.picture ? (
            <img src={profile.picture} alt={displayName} className="h-full w-full object-cover" />
          ) : (
            avatarInitial
          )}
        </div>
        <div>
          <p className="text-[14px] font-semibold text-[#f7f7f8]">@{displayName}</p>
          <p className="text-[11px] font-normal text-[#a1a1aa]">
            {videoCount} video{videoCount !== 1 ? 's' : ''} published
          </p>
        </div>
      </div>
      {session && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onFollow(pubkey) }}
          className={`rounded-[11px] px-[16px] py-[8px] text-[13px] font-semibold transition-all duration-150 active:scale-95 ${
            isFollowing
              ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
              : 'bg-[#18181d] text-white'
          }`}
        >
          {isFollowing ? 'Unfollow' : 'Follow'}
        </button>
      )}
    </div>
  )
}

export const ProfilePage: React.FC = () => {
  const { session, pool, signEvent } = useNostr()
  const { pubkey } = useParams<{ pubkey: string }>()
  const navigate = useNavigate()
  const relayUrls = useUserRelayUrls(session?.pubkey)

  const [activeTab, setActiveTab] = useState<'videos' | 'boosts' | 'about'>('videos')
  const [listView, setListView] = useState<'followers' | 'following' | null>(null)

  // Resolve target pubkey (route param or self session key)
  const targetPubkey = pubkey && pubkey !== 'me' ? pubkey : session?.pubkey

  // Reset list view when navigating to a different profile
  useEffect(() => {
    setListView(null)
  }, [targetPubkey])

  // Fetch creator profile details
  const profile = useProfile(targetPubkey || '')
  const displayName = profile.displayName || profile.name || 'Nostr User'
  const creatorLabel = `@${profile.name}`

  // Retrieve raw short-video events authored by target pubkey from Dexie cache
  const _rawVideoEvents = useLiveQuery(
    () => targetPubkey
      ? db.cachedEvents.where('pubkey').equals(targetPubkey).filter(e => e.kind === 21 || e.kind === 22 || e.kind === 34236).toArray()
      : Promise.resolve([] as any[]),
    [targetPubkey]
  )
  const rawVideoEvents = useMemo(() => _rawVideoEvents ?? [], [_rawVideoEvents])

  // Parse events into standard feed item list (unwrap from CachedEvent)
  const videos = useMemo(() => {
    return rawVideoEvents
      .map((ev: any) => parseVideoEvent(ev.event || ev))
      .filter((v: any): v is VideoItemData => v !== null)
  }, [rawVideoEvents])

  // Retrieve all video creators from the videoShapes pubkey index
  const _creatorsWithVideos = useLiveQuery(
    async () => {
      const keys = await db.videoShapes.orderBy('pubkey').uniqueKeys()
      return new Set(keys as string[])
    },
    []
  )
  const creatorsWithVideos = useMemo(() => _creatorsWithVideos ?? new Set(), [_creatorsWithVideos])

  // Retrieve raw kind:6 or kind:16 repost events
  const rawBoosts: any[] = useLiveQuery(
    () => targetPubkey
      ? db.cachedEvents.where('pubkey').equals(targetPubkey).filter(e => e.kind === 6 || e.kind === 16).toArray()
      : Promise.resolve([] as any[]),
    [targetPubkey]
  ) ?? []

  // Retrieve contact list (kind 3) authored by target pubkey to calculate Following count
  const targetContactListEvents: any[] = useLiveQuery(
    () => targetPubkey
      ? db.cachedEvents.where({ kind: 3, pubkey: targetPubkey }).toArray()
      : Promise.resolve([] as any[]),
    [targetPubkey]
  ) ?? []
  const targetContactListEvent = targetContactListEvents[targetContactListEvents.length - 1]?.event

  const followingCount = useMemo(() => {
    if (!targetContactListEvent) return 0
    return targetContactListEvent.tags.filter((t: any) => t[0] === 'p').length
  }, [targetContactListEvent])

  // Retrieve contact list (kind 3) events referencing target pubkey to calculate Followers count
  const _followerEvents = useLiveQuery(
    async () => {
      if (!targetPubkey) return [] as any[]
      return db.cachedEvents.where('pTags').equals(targetPubkey).filter(e => e.kind === 3).toArray()
    },
    [targetPubkey]
  )
  const followerEvents = useMemo(() => _followerEvents ?? [], [_followerEvents])

  const followersCount = useMemo(() => {
    const uniqueAuthors = new Set(followerEvents.map((ev: any) => ev.pubkey))
    return uniqueAuthors.size
  }, [followerEvents])

  const followerPubkeys = useMemo(() => {
    return [...new Set(followerEvents.map((ev: any) => ev.pubkey))]
  }, [followerEvents])

  const followingPubkeys = useMemo(() => {
    if (!targetContactListEvent) return []
    return targetContactListEvent.tags
      .filter((t: any) => t[0] === 'p')
      .map((t: any) => t[1])
  }, [targetContactListEvent])

  const followersWithVideos = useMemo(() => {
    return followerPubkeys.filter((pk: string) => creatorsWithVideos.has(pk))
  }, [followerPubkeys, creatorsWithVideos])

  const followingWithVideos = useMemo(() => {
    return followingPubkeys.filter((pk: string) => creatorsWithVideos.has(pk))
  }, [followingPubkeys, creatorsWithVideos])

  // Retrieve logged-in user's own contact list to check if following this creator
  const myContactListEvents: any[] = useLiveQuery(
    async () => {
      if (!session?.pubkey) return []
      return db.cachedEvents.where({ kind: 3, pubkey: session.pubkey }).toArray()
    },
    [session?.pubkey]
  ) ?? []
  const myContactListEvent = myContactListEvents[myContactListEvents.length - 1]?.event

  const isFollowing = useMemo(() => {
    if (!myContactListEvent || !targetPubkey) return false
    return myContactListEvent.tags.some((t: any) => t[0] === 'p' && t[1] === targetPubkey)
  }, [myContactListEvent, targetPubkey])

  const isFollowingPubkeys = useMemo(() => {
    if (!myContactListEvent) return new Set<string>()
    return new Set(
      myContactListEvent.tags
        .filter((t: any) => t[0] === 'p')
        .map((t: any) => t[1])
    )
  }, [myContactListEvent])

  // Retrieve logged-in user's mute list (kind:10000) to check if this creator is blocked
  const myMuteListEvents: any[] = useLiveQuery(
    async () => {
      if (!session?.pubkey) return []
      return db.cachedEvents.where({ kind: 10000, pubkey: session.pubkey }).toArray()
    },
    [session?.pubkey]
  ) ?? []
  const myMuteListEvent = myMuteListEvents[myMuteListEvents.length - 1]?.event

  const mutedPubkeys = useMemo<Set<string>>(() => {
    if (!myMuteListEvent) return new Set<string>()
    const pubkeys: string[] = myMuteListEvent.tags
      .filter((t: any) => t[0] === 'p')
      .map((t: any) => t[1])
    return new Set(pubkeys)
  }, [myMuteListEvent])

  const isBlocked = targetPubkey ? mutedPubkeys.has(targetPubkey) : false

  // Subscribe to contact list updates on relays — only if cache is stale
  useEffect(() => {
    if (!targetPubkey) return
    let cancelled = false

    db.cachedEvents.where({ kind: 3, pubkey: targetPubkey }).count().then((count) => {
      if (cancelled) return
      const hasOwnContactList = count > 0

      db.cachedEvents.where('pTags').equals(targetPubkey).filter(e => e.kind === 3).count().then((followerCount) => {
        if (cancelled) return

        // Skip subscription when we already have recent cached data for this profile
        if (hasOwnContactList && followerCount >= 3) {
          console.log(`[Profile] Skipping kind:3 sub for ${targetPubkey} — cache has ${count} own + ${followerCount} followers`)
          return
        }

        console.log(`[Profile] Subscribing to contact lists for stats of pubkey: ${targetPubkey} (own=${hasOwnContactList}, followers=${followerCount})`)

        const sub = subscribeToRelays(relayUrls, [
          { kinds: [3], authors: [targetPubkey], limit: 1 },
          { kinds: [3], '#p': [targetPubkey], limit: 50 },
        ])

        cleanup = sub
      })
    })

    let cleanup: (() => void) | undefined

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [targetPubkey, relayUrls])

  // Subscribe to video events for the target user
  useEffect(() => {
    if (!targetPubkey) return
    console.log(`Subscribing to video events for pubkey: ${targetPubkey}`)

    const sub = subscribeToRelays(relayUrls, {
      kinds: VIDEO_KINDS,
      authors: [targetPubkey],
      limit: 50,
    })

    return () => sub()
  }, [targetPubkey, relayUrls])

  // Subscribe to the session user's mute list
  useEffect(() => {
    if (!session?.pubkey) return
    const sub = subscribeToRelays(relayUrls, {
      kinds: [10000],
      authors: [session.pubkey],
      limit: 1,
    })
    return () => sub()
  }, [session?.pubkey, relayUrls])

  // Subscribe to kind:0 metadata for displayed follower/following pubkeys
  useEffect(() => {
    if (!listView || !relayUrls.length) return
    const pubkeys = listView === 'followers' ? followersWithVideos : followingWithVideos
    const realPubkeys = pubkeys.filter((pk: string) => !pk.startsWith('mock-'))
    if (!realPubkeys.length) return

    // Save the pubkeys to check against in an async context
    const checkCache = async () => {
      const uncached: string[] = []
      for (const pk of realPubkeys) {
        const cached = await db.cachedEvents.where({ kind: 0, pubkey: pk }).first()
        if (!cached) uncached.push(pk)
      }
      return uncached
    }
    checkCache().then(uncachedPubkeys => {
      if (!uncachedPubkeys.length) {
        console.log(`All profiles already cached for ${listView} view`)
        return
      }
      const sub = subscribeToRelays(relayUrls, {
        kinds: [0],
        authors: uncachedPubkeys,
        limit: 1,
      })
      // Cleanup is trickier here; the subscription will be cleaned on effect teardown
      // via the returned unsub below, but for the inner sub we just let it close naturally
    })

    return () => {}
  }, [listView, followersWithVideos, followingWithVideos, relayUrls])

  const handleEditProfile = () => {
    navigate('/settings')
  }

  const handleFollowToggle = async () => {
    if (!session) {
      alert('Please connect your Nostr account to follow creators')
      return
    }
    try {
      const { signed, action } = await publishFollow(
        signEvent,
        targetPubkey || '',
        myContactListEvent || null
      )
      await saveEventToCache(signed)
      alert(action === 'follow' ? 'Followed creator!' : 'Unfollowed creator!')
    } catch (err: any) {
      console.error('Follow toggle failed:', err)
      alert('Failed to update follow status: ' + (err.message || err))
    }
  }

  const handleBlockToggle = async () => {
    if (!session || !targetPubkey) return
    try {
      const newPubkeys = isBlocked
        ? Array.from(mutedPubkeys).filter((pk) => pk !== targetPubkey)
        : [...Array.from(mutedPubkeys), targetPubkey]
      const { signed } = await publishMuteList(signEvent, newPubkeys, [])
      await saveEventToCache(signed)
      alert(isBlocked ? 'Unblocked creator!' : 'Blocked creator!')
    } catch (err: any) {
      console.error('Block toggle failed:', err)
      alert('Failed to update block list: ' + (err.message || err))
    }
  }

  const handleFollow = async (target: string) => {
    if (!session) return
    try {
      const { signed, action } = await publishFollow(signEvent, target, myContactListEvent || null)
      await saveEventToCache(signed)
      alert(action === 'follow' ? 'Followed!' : 'Unfollowed!')
    } catch (err: any) {
      console.error('Follow toggle failed:', err)
      alert('Failed to update follow status: ' + (err.message || err))
    }
  }

  if (!targetPubkey) {
    return (
      <div className="flex min-h-full flex-col bg-[#09090b] px-4 pb-4 pt-4 text-[#f7f7f8] items-center justify-center">
        <p className="text-[14px] text-[#a1a1aa] mb-4">Please log in to view your profile.</p>
        <button
          onClick={() => navigate('/')}
          className="rounded-[11px] bg-[#8b5cf6] px-4 py-2 text-[13px] font-semibold text-white"
        >
          Go to Feed
        </button>
      </div>
    )
  }

  const avatarInitial = displayName.slice(0, 1).toUpperCase() || 'N'
  const isSelf = targetPubkey === session?.pubkey

  return (
    <div className="flex min-h-full flex-col bg-[#09090b] px-4 pb-16 pt-4 text-[#f7f7f8] md:pb-4">
      {/* Header */}
      <div className="flex h-[56px] items-center justify-between">
        <h2 className="text-[18px] font-bold truncate pr-3">{creatorLabel}</h2>
        <button
          onClick={() => navigate('/settings')}
          className="text-neutral-400 hover:text-white p-1"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-col gap-[16px]">
        {/* Profile Card & Counts */}
        <div className="flex items-center gap-[20px]">
          <div
            className="flex size-[78px] overflow-hidden shrink-0 items-center justify-center rounded-full text-[27px] font-bold text-white bg-purple-600 border-2 border-neutral-900 shadow-md"
          >
            {profile.picture ? (
              <img src={profile.picture} alt={displayName} className="h-full w-full object-cover" />
            ) : (
              avatarInitial
            )}
          </div>
          <div className="flex gap-[28px]">
            <div className="flex flex-col items-center">
              <span className="text-[16px] font-bold text-[#f7f7f8]">{videos.length}</span>
              <span className="text-[10px] font-semibold text-[#a1a1aa]">Videos</span>
            </div>
            <button
              onClick={() => setListView('followers')}
              className="flex flex-col items-center cursor-pointer hover:opacity-80 transition-opacity"
            >
              <span className="text-[16px] font-bold text-[#f7f7f8]">
                {followersCount >= 1000 ? `${(followersCount / 1000).toFixed(followersCount % 1000 === 0 ? 0 : 1)}k` : followersCount}
              </span>
              <span className="text-[10px] font-semibold text-[#a1a1aa]">Followers</span>
            </button>
            <button
              onClick={() => setListView('following')}
              className="flex flex-col items-center cursor-pointer hover:opacity-80 transition-opacity"
            >
              <span className="text-[16px] font-bold text-[#f7f7f8]">{followingCount}</span>
              <span className="text-[10px] font-semibold text-[#a1a1aa]">Following</span>
            </button>
          </div>
        </div>

        {/* Creator Info details */}
        <div className="space-y-1">
          <h3 className="text-[18px] font-bold text-[#f7f7f8]">
            {displayName} {profile.isVerified ? <span className="text-blue-400 text-[14px]">✓</span> : ''}
          </h3>
          {profile.about && (
            <p className="text-[13px] font-normal leading-relaxed text-[#a1a1aa] whitespace-pre-line break-words max-w-full">
              {profile.about}
            </p>
          )}
          {profile.website && (
            <a
              href={profile.website.includes('://') ? profile.website : `https://${profile.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-[12px] font-semibold text-[#a78bfa] hover:underline truncate"
            >
              {profile.website}
            </a>
          )}
        </div>

        {/* Action Button */}
        {isSelf ? (
          <button
            onClick={handleEditProfile}
            className="h-[40px] w-full rounded-[12px] bg-[#18181d] text-[13px] font-bold text-white hover:bg-neutral-800 transition-colors"
          >
            Edit profile settings
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={handleFollowToggle}
              className={`h-[40px] flex-1 rounded-[12px] text-[13px] font-bold text-white transition-colors ${
                isFollowing ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30' : 'bg-[#8b5cf6] hover:bg-[#7c3aed]'
              }`}
            >
              {isFollowing ? 'Unfollow Creator' : 'Follow Creator'}
            </button>
            <button
              onClick={handleBlockToggle}
              className={`h-[40px] flex-1 rounded-[12px] text-[13px] font-bold transition-colors ${
                isBlocked
                  ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
                  : 'bg-[#27272a] text-[#a1a1aa] hover:bg-red-600/20 hover:text-red-400'
              }`}
            >
              {isBlocked ? 'Unblock' : 'Block'}
            </button>
          </div>
        )}

        {/* Tab Controls / List View */}
        {listView ? (
          <>
            <button
              onClick={() => setListView(null)}
              className="flex items-center gap-2 text-[14px] font-semibold text-[#a78bfa] mb-3 hover:underline"
            >
              <ArrowLeft className="w-4 h-4" /> Back to profile
            </button>

            <h3 className="text-[16px] font-semibold text-[#f7f7f8] mb-3">
              {listView === 'followers' ? 'Followers' : 'Following'} ({listView === 'followers' ? followersWithVideos.length : followingWithVideos.length})
            </h3>

            <div className="flex-1 space-y-1 overflow-y-auto max-h-[400px] pr-1">
              {(listView === 'followers' ? followersWithVideos : followingWithVideos).length === 0 ? (
                <p className="text-[13px] text-[#71717a] text-center py-8">No {listView} with videos found.</p>
              ) : (
                (listView === 'followers' ? followersWithVideos : followingWithVideos).map((pk: string) => (
                  <CreatorListItem
                    key={pk}
                    pubkey={pk}
                    isFollowing={isFollowingPubkeys.has(pk)}
                    session={session}
                    onFollow={handleFollow}
                  />
                ))
              )}
            </div>
          </>
        ) : (
          <>
            {/* Tab Controls + Content */}
            <Tabs.Root value={activeTab} onValueChange={(v) => setActiveTab(v as 'videos' | 'boosts' | 'about')}>
              <Tabs.List className="flex h-[36px] items-center border-b border-neutral-900 text-[13px] mt-2 font-medium">
                <Tabs.Trigger
                  value="videos"
                  className="flex-1 flex justify-center items-center gap-1.5 pb-2 border-b-2 data-[state=active]:border-[#8b5cf6] data-[state=active]:text-[#f7f7f8] data-[state=active]:font-bold data-[state=inactive]:border-transparent data-[state=inactive]:text-[#a1a1aa]"
                >
                  <FileVideo className="w-4 h-4" /> Videos
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="boosts"
                  className="flex-1 flex justify-center items-center gap-1.5 pb-2 border-b-2 data-[state=active]:border-[#8b5cf6] data-[state=active]:text-[#f7f7f8] data-[state=active]:font-bold data-[state=inactive]:border-transparent data-[state=inactive]:text-[#a1a1aa]"
                >
                  <RotateCw className="w-4 h-4" /> Boosts
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="about"
                  className="flex-1 flex justify-center items-center gap-1.5 pb-2 border-b-2 data-[state=active]:border-[#8b5cf6] data-[state=active]:text-[#f7f7f8] data-[state=active]:font-bold data-[state=inactive]:border-transparent data-[state=inactive]:text-[#a1a1aa]"
                >
                  <Info className="w-4 h-4" /> About
                </Tabs.Trigger>
              </Tabs.List>

              <div className="pt-2">
                <Tabs.Content value="videos">
                  {videos.length === 0 ? (
                    <p className="text-[13px] text-[#71717a] text-center py-8">No vertical videos published yet.</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-1">
                      {videos.map((video) => (
                        <div
                          key={video.id}
                          onClick={() => navigate(`/?v=${video.id}`)}
                          className="relative aspect-[9/16] cursor-pointer overflow-hidden rounded-[8px] bg-[#18181d] transition-all hover:scale-[1.03]"
                        >
                          {video.poster ? (
                            <img src={video.poster} alt={video.title} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-purple-900/20 text-[#a78bfa] text-[20px]">
                              ▶
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-[#09090b]/80 via-transparent to-transparent" />
                          <p className="absolute bottom-1.5 left-1.5 right-1.5 text-[9px] text-[#f7f7f8] line-clamp-2 leading-tight">
                            {video.title || video.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </Tabs.Content>

                <Tabs.Content value="boosts">
                  {rawBoosts.length === 0 ? (
                    <p className="text-[13px] text-[#71717a] text-center py-8">No reposted/boosted clips.</p>
                  ) : (
                    <div className="space-y-2">
                      {rawBoosts.map((boost) => (
                        <div key={boost.id} className="p-3 bg-[#18181d] rounded-xl text-[12px] leading-relaxed">
                          <p className="text-[#a1a1aa] flex items-center gap-1.5 font-semibold">
                            <RotateCw className="w-3.5 h-3.5 text-green-400" /> Reposted kind:{boost.kind}
                          </p>
                          <p className="text-neutral-500 font-mono text-[9px] mt-1 truncate">Event ID: {boost.id}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </Tabs.Content>

                <Tabs.Content value="about">
                  <div className="bg-[#111115] p-4 rounded-xl border border-neutral-900 space-y-4">
                    <div>
                      <p className="text-[11px] font-bold text-[#a1a1aa] uppercase tracking-wider">Public Key Hex</p>
                      <p className="text-[12px] font-mono text-[#f7f7f8] break-all bg-[#18181d] p-2.5 rounded-lg mt-1 select-all">
                        {targetPubkey}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 text-[12px] text-[#a1a1aa]">
                      <Calendar className="w-4 h-4" />
                      <span>Joined Nostr</span>
                    </div>
                  </div>
                </Tabs.Content>
              </div>
            </Tabs.Root>
          </>
        )}
      </div>
    </div>
  )
}
