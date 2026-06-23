import React, { useState, useEffect, useMemo } from 'react'
import { MoreHorizontal, FileVideo, RotateCw, Info, Calendar, ArrowLeft } from 'lucide-react'
import { useParams, useNavigate } from 'react-router-dom'
import { useNostr } from '../../app/providers'
import { getEventsQuery$, subscribeToRelays } from '../../nostr/pool'
import { use$ } from 'applesauce-react/hooks'
import { parseVideoEvent } from '../../nostr/events/video'
import { VideoItemData } from '../feed/VideoFeedItem'
import { useProfile } from '../../nostr/profile'
import { publishFollow } from '../../nostr/events/reactions'
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

  const rawVideoEvents = use$(
    () => getEventsQuery$({ kinds: VIDEO_KINDS, authors: [pubkey] }),
    [pubkey]
  ) ?? EMPTY_VIDEOS

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
  const { session, rxNostr, signEvent, eventStore } = useNostr()
  const { pubkey } = useParams<{ pubkey: string }>()
  const navigate = useNavigate()
  const relayUrls = useUserRelayUrls(eventStore, session?.pubkey)

  const [activeTab, setActiveTab] = useState<'videos' | 'boosts' | 'about'>('videos')
  const [listView, setListView] = useState<'followers' | 'following' | null>(null)

  // Resolve target pubkey (route param or self session key)
  const targetPubkey = pubkey && pubkey !== 'me' ? pubkey : session?.pubkey

  // Fetch creator profile details
  const profile = useProfile(targetPubkey || '')
  const displayName = profile.displayName || profile.name || 'Nostr User'
  const creatorLabel = `@${profile.name}`

  // Retrieve raw short-video events authored by target pubkey
  const rawVideoEvents = use$(
    () => getEventsQuery$({ kinds: [21, 22, 34236], authors: targetPubkey ? [targetPubkey] : [] }),
    [targetPubkey]
  ) ?? EMPTY_VIDEOS

  // Parse events into standard feed item list
  const videos = useMemo(() => {
    return rawVideoEvents
      .map((ev: any) => parseVideoEvent(ev))
      .filter((v: any): v is VideoItemData => v !== null)
  }, [rawVideoEvents])

  // Retrieve raw kind:6 or kind:16 repost events
  const rawBoosts = use$(
    () => getEventsQuery$({ kinds: [6, 16], authors: targetPubkey ? [targetPubkey] : [] }),
    [targetPubkey]
  ) ?? EMPTY_EVENTS

  // Retrieve contact list (kind 3) authored by target pubkey to calculate Following count
  const targetContactListEvent = use$(
    () => getEventsQuery$({ kinds: [3], authors: targetPubkey ? [targetPubkey] : [] }),
    [targetPubkey]
  )?.[0]

  const followingCount = useMemo(() => {
    if (!targetContactListEvent) return 0
    return targetContactListEvent.tags.filter((t: any) => t[0] === 'p').length
  }, [targetContactListEvent])

  // Retrieve contact list (kind 3) events referencing target pubkey to calculate Followers count
  const followerEvents = use$(
    () => getEventsQuery$({ kinds: [3], '#p': targetPubkey ? [targetPubkey] : [] }),
    [targetPubkey]
  ) ?? EMPTY_EVENTS

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

  // Retrieve logged-in user's own contact list to check if following this creator
  const myContactListEvent = use$(
    () => getEventsQuery$({ kinds: [3], authors: session?.pubkey ? [session.pubkey] : [] }),
    [session?.pubkey]
  )?.[0]

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

  // Subscribe to contact list updates on relays
  useEffect(() => {
    if (!targetPubkey) return
    console.log(`Subscribing to contact lists for stats of pubkey: ${targetPubkey}`)

    const sub = subscribeToRelays(relayUrls, [
      { kinds: [3], authors: [targetPubkey], limit: 1 },
      { kinds: [3], '#p': [targetPubkey], limit: 50 },
    ])

    return () => {
      sub()
    }
  }, [targetPubkey, relayUrls])

  // Subscribe to kind:0 metadata for displayed follower/following pubkeys
  useEffect(() => {
    if (!listView || !relayUrls.length) return
    const pubkeys = listView === 'followers' ? followerPubkeys : followingPubkeys
    const realPubkeys = pubkeys.filter((pk: string) => !pk.startsWith('mock-'))
    if (!realPubkeys.length) return
    const sub = subscribeToRelays(relayUrls, {
      kinds: [0],
      authors: realPubkeys,
      limit: 1,
    })
    return () => sub()
  }, [listView, followerPubkeys, followingPubkeys, relayUrls])

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
        rxNostr,
        targetPubkey || '',
        myContactListEvent || null
      )
      eventStore.add(signed)
      alert(action === 'follow' ? 'Followed creator!' : 'Unfollowed creator!')
    } catch (err: any) {
      console.error('Follow toggle failed:', err)
      alert('Failed to update follow status: ' + (err.message || err))
    }
  }

  const handleFollow = async (target: string) => {
    if (!session) return
    try {
      const { signed, action } = await publishFollow(signEvent, rxNostr, target, myContactListEvent || null)
      eventStore.add(signed)
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
              href={profile.website.startsWith('http') ? profile.website : `https://${profile.website}`}
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
          <button
            onClick={handleFollowToggle}
            className={`h-[40px] w-full rounded-[12px] text-[13px] font-bold text-white transition-colors ${
              isFollowing ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30' : 'bg-[#8b5cf6] hover:bg-[#7c3aed]'
            }`}
          >
            {isFollowing ? 'Unfollow Creator' : 'Follow Creator'}
          </button>
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
              {listView === 'followers' ? 'Followers' : 'Following'} ({listView === 'followers' ? followerPubkeys.length : followingPubkeys.length})
            </h3>

            <div className="flex-1 space-y-1 overflow-y-auto max-h-[400px] pr-1">
              {(listView === 'followers' ? followerPubkeys : followingPubkeys).length === 0 ? (
                <p className="text-[13px] text-[#71717a] text-center py-8">No {listView} found.</p>
              ) : (
                (listView === 'followers' ? followerPubkeys : followingPubkeys).map((pk: string) => (
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
            {/* Tab Controls */}
            <div className="flex h-[36px] items-center border-b border-neutral-900 text-[13px] mt-2 font-medium">
              <button
                onClick={() => setActiveTab('videos')}
                className={`flex-1 flex justify-center items-center gap-1.5 pb-2 border-b-2 ${
                  activeTab === 'videos' ? 'border-[#8b5cf6] text-[#f7f7f8] font-bold' : 'border-transparent text-[#a1a1aa]'
                }`}
              >
                <FileVideo className="w-4 h-4" /> Videos
              </button>
              <button
                onClick={() => setActiveTab('boosts')}
                className={`flex-1 flex justify-center items-center gap-1.5 pb-2 border-b-2 ${
                  activeTab === 'boosts' ? 'border-[#8b5cf6] text-[#f7f7f8] font-bold' : 'border-transparent text-[#a1a1aa]'
                }`}
              >
                <RotateCw className="w-4 h-4" /> Boosts
              </button>
              <button
                onClick={() => setActiveTab('about')}
                className={`flex-1 flex justify-center items-center gap-1.5 pb-2 border-b-2 ${
                  activeTab === 'about' ? 'border-[#8b5cf6] text-[#f7f7f8] font-bold' : 'border-transparent text-[#a1a1aa]'
                }`}
              >
                <Info className="w-4 h-4" /> About
              </button>
            </div>

            {/* Tab content layouts */}
            <div className="pt-2">
              {activeTab === 'videos' && (
                videos.length === 0 ? (
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
                )
              )}

              {activeTab === 'boosts' && (
                rawBoosts.length === 0 ? (
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
                )
              )}

              {activeTab === 'about' && (
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
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
