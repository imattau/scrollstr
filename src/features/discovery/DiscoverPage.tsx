import React, { useState, useMemo, useEffect } from 'react'
import { Search } from 'lucide-react'
import { useNostr } from '../../app/providers'
import { subscribeToRelays } from '../../nostr/pool'
import { db, VideoShape, saveEventToCache } from '../../nostr/cache'
import { useLiveQuery } from 'dexie-react-hooks'
import { VideoItemData } from '../feed/VideoFeedItem'
import { useProfile } from '../../nostr/profile'
import { publishFollow } from '../../nostr/events'
import { useNavigate } from 'react-router-dom'
import { useUserRelayUrls } from '../../nostr/relays'

const EMPTY_VIDEOS: any[] = []
const VIDEO_KINDS = [21, 22, 34236]

const TrendingCreatorRow: React.FC<{
  creator: { pubkey: string; name: string; subtitle: string; color: string }
  isFollowing: boolean
  session: any
  onFollow: (pubkey: string) => void
}> = ({ creator, isFollowing, session, onFollow }) => {
  const navigate = useNavigate()
  const profile = useProfile(creator.pubkey)
  const displayName = profile.displayName || profile.name || creator.name
  const avatarInitial = displayName.slice(0, 1).toUpperCase() || 'N'

  return (
    <div className="flex items-center justify-between py-2">
      <div
        className="flex items-center gap-3 cursor-pointer"
        onClick={() => navigate(`/profile/${creator.pubkey}`)}
      >
        <div
          className="flex size-[44px] overflow-hidden items-center justify-center rounded-full text-[15px] font-bold text-white shrink-0"
          style={{ backgroundColor: creator.color }}
        >
          {profile.picture ? (
            <img src={profile.picture} alt={displayName} className="h-full w-full object-cover" />
          ) : (
            avatarInitial
          )}
        </div>
        <div>
          <p className="text-[14px] font-semibold text-[#f7f7f8]">@{displayName}</p>
          <p className="text-[11px] font-normal text-[#a1a1aa]">{creator.subtitle}</p>
        </div>
      </div>
      {session && (
        <button
          type="button"
          onClick={() => onFollow(creator.pubkey)}
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

export const DiscoverPage: React.FC = () => {
  const { session, pool, signEvent } = useNostr()
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const relayUrls = useUserRelayUrls(session?.pubkey)

  // Check cache freshness once on mount; only subscribe to relays if the
  // cache has fewer than 20 videos from the last hour — avoids redundant
  // network requests on repeat visits (the auto-backfill already keeps the
  // cache populated).
  const [cacheSeemsStale, setCacheSeemsStale] = useState(false)

  useEffect(() => {
    if (!relayUrls.length) return
    let current = true
    db.videoShapes
      .where('created_at')
      .above(Math.floor(Date.now() / 1000) - 3600)
      .count()
      .then((count) => {
        if (current && count < 20) setCacheSeemsStale(true)
      })
    return () => {
      current = false
    }
  }, [relayUrls])

  useEffect(() => {
    if (!relayUrls.length || !cacheSeemsStale) return
    const unsub = subscribeToRelays(relayUrls, {
      kinds: VIDEO_KINDS,
      limit: 100,
    })
    return () => unsub()
  }, [relayUrls, cacheSeemsStale])

  // Query video shapes from the Dexie cache (last 48 hours)
  const rawVideoShapes = useLiveQuery(
    () => db.videoShapes
      .where('created_at')
      .above(Math.floor(Date.now() / 1000) - 48 * 3600)
      .filter(shape => shape.mediaStatus !== 'failed')
      .toArray(),
    []
  ) ?? EMPTY_VIDEOS

  // Map shapes to local format
  const videos = useMemo(() => {
    return (rawVideoShapes as VideoShape[]).map((shape): VideoItemData => ({
      id: shape.id,
      kind: 22,
      createdAt: shape.created_at,
      title: shape.title ?? '',
      description: shape.summary ?? '',
      url: shape.videoUrl,
      poster: shape.thumbnailUrl,
      creator: {
        pubkey: shape.pubkey,
        name: shape.authorName || shape.pubkey.slice(0, 8),
        picture: shape.authorPicture
      },
      hashtags: shape.hashtags || [],
      likesCount: shape.reactionCount || 0,
      commentsCount: shape.replyCount || 0,
      boostsCount: shape.repostCount || 0,
      zapsCount: shape.zapCount || 0,
      music: 'Original Clip Audio',
    }))
  }, [rawVideoShapes])

  // Load author profiles into a lookup map for richer search
  const _authorProfileMap = useLiveQuery(
    () => db.authorProfiles.toArray().then(profiles => {
      const map: Record<string, { name: string; displayName?: string; nip05?: string }> = {}
      for (const p of profiles) {
        map[p.pubkey] = { name: p.name, displayName: p.displayName, nip05: p.nip05 }
      }
      return map
    }),
    []
  )
  const authorProfileMap = useMemo(() => _authorProfileMap ?? {}, [_authorProfileMap])

  // Only consider recent videos for trending computation
  const recentVideos = useMemo(() => {
    const sorted = [...videos].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    return sorted.slice(0, 300)
  }, [videos])

  // Extract unique hashtags/topics dynamically from recent videos
  const topics = useMemo(() => {
    const counts: Record<string, number> = {}
    recentVideos.forEach((v) => {
      v.hashtags?.forEach((tag) => {
        const normalized = tag.toLowerCase()
        counts[normalized] = (counts[normalized] || 0) + 1
      })
    })

    // Fallback static topics if no videos have tags
    const defaultTopics = [
      { label: 'melbourne', count: '1 video', bg: '#241a38' },
      { label: 'nature', count: '1 video', bg: '#30201d' },
      { label: 'dance', count: '1 video', bg: '#162b2c' },
    ]

    const compiled = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, count], idx) => {
        const bgs = ['#241a38', '#30201d', '#162b2c', '#1b1b22', '#221528']
        return {
          label,
          count: `${count} video${count > 1 ? 's' : ''}`,
          bg: bgs[idx % bgs.length],
        }
      })

    return compiled.length > 0 ? compiled : defaultTopics
  }, [recentVideos])

  // Extract active creators dynamically from recent videos
  const creators = useMemo(() => {
    const creatorMap: Record<string, { pubkey: string; name: string; count: number }> = {}
    recentVideos.forEach((v) => {
      const pubkey = v.creator.pubkey
      if (!creatorMap[pubkey]) {
        creatorMap[pubkey] = {
          pubkey,
          name: v.creator.name,
          count: 0,
        }
      }
      creatorMap[pubkey].count += 1
    })

    const defaultCreators = [
      { pubkey: 'mock-key-1', name: 'maya', subtitle: 'City films', color: '#60a5fa' },
      { pubkey: 'mock-key-2', name: 'nora', subtitle: 'Generative art', color: '#f05252' },
      { pubkey: 'mock-key-3', name: 'kai', subtitle: 'Open web', color: '#31c48d' },
    ]

    const compiled = Object.values(creatorMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((c, idx) => {
        const colors = ['#60a5fa', '#f05252', '#31c48d', '#a78bfa', '#f5b942']
        return {
          pubkey: c.pubkey,
          name: c.name,
          subtitle: `${c.count} video${c.count > 1 ? 's' : ''} published`,
          color: colors[idx % colors.length],
        }
      })

    return compiled.length > 0 ? compiled : defaultCreators
  }, [recentVideos])

  // Subscribe to kind:0 only for creators whose profiles aren't already cached
  useEffect(() => {
    const realCreators = creators
      .filter(c => !c.pubkey.startsWith('mock-'))
      .map(c => c.pubkey)
    if (!realCreators.length || !relayUrls.length) return

    const unsubRef: { current: (() => void) | undefined } = { current: undefined }
    let current = true

    db.authorProfiles
      .where('pubkey')
      .anyOf(realCreators)
      .primaryKeys()
      .then((cachedPubkeys) => {
        if (!current) return
        const uncached = realCreators.filter((pk) => !cachedPubkeys.includes(pk))
        if (uncached.length === 0) return
        unsubRef.current = subscribeToRelays(relayUrls, {
          kinds: [0],
          authors: uncached,
          limit: 1,
        })
      })

    return () => {
      current = false
      unsubRef.current?.()
    }
  }, [creators, relayUrls])

  // Get logged-in user's contact list to determine follow state
  const myContactListEvents = useLiveQuery(
    () => session?.pubkey
      ? db.cachedEvents.where({ kind: 3, pubkey: session.pubkey }).toArray()
      : [],
    [session?.pubkey]
  ) ?? []
  const myContactListEvent = myContactListEvents[myContactListEvents.length - 1] as any

  const isFollowingPubkeys = useMemo(() => {
    if (!myContactListEvent?.event) return new Set<string>()
    return new Set(
      myContactListEvent.event.tags
        .filter((t: any) => t[0] === 'p')
        .map((t: any) => t[1])
    )
  }, [myContactListEvent])

  // Filter videos based on the search query
  const filteredVideos = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    return videos.filter((v) => {
      const matchTitle = v.title?.toLowerCase().includes(q)
      const matchDesc = v.description?.toLowerCase().includes(q)
      const matchTag = v.hashtags?.some((t) => t.toLowerCase().includes(q))
      const matchCreator = v.creator.name.toLowerCase().includes(q)
      const matchPubkey = v.creator.pubkey.toLowerCase().includes(q)
      const profile = authorProfileMap[v.creator.pubkey]
      const matchDisplayName = profile?.displayName?.toLowerCase().includes(q)
      const matchNip05 = profile?.nip05?.toLowerCase().includes(q)
      return matchTitle || matchDesc || matchTag || matchCreator || matchPubkey || matchDisplayName || matchNip05
    })
  }, [videos, searchQuery, authorProfileMap])

  const handleFollow = async (targetPubkey: string) => {
    if (!session) {
      alert('Please connect your Nostr account to follow creators')
      return
    }
    try {
      const { signed, action } = await publishFollow(
        signEvent,
        targetPubkey,
        myContactListEvent?.event || null
      )
      await saveEventToCache(signed)
    } catch (err: any) {
      console.error('Follow toggle failed:', err)
      alert('Failed to update follow status: ' + (err.message || err))
    }
  }

  return (
    <div className="flex min-h-full flex-col bg-[#09090b] px-4 pb-4 pt-4 text-[#f7f7f8]">
      <div className="flex h-[56px] items-center justify-between">
        <h2 className="text-[18px] font-bold">Discover</h2>
      </div>

      <div className="flex flex-1 flex-col gap-[18px]">
        {/* Search bar */}
        <div className="flex items-center gap-3 rounded-[14px] bg-[#18181d] px-[14px] py-[12px] text-[#a1a1aa]">
          <Search className="h-4 w-4" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search creators, tags or descriptions"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-[#a1a1aa]"
          />
        </div>

        {searchQuery.trim() ? (
          /* Search results section */
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-semibold text-[#a1a1aa]">
                Search Results ({filteredVideos.length})
              </h3>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-[12px] font-semibold text-[#a78bfa] hover:underline"
              >
                Clear
              </button>
            </div>
            {filteredVideos.length === 0 ? (
              <p className="text-[13px] text-[#71717a] py-6 text-center">
                No videos or creators matched your search.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 pb-8">
                {filteredVideos.map((video) => (
                  <div
                    key={video.id}
                    onClick={() => navigate(`/?v=${video.id}`)}
                    className="group relative aspect-[9/16] cursor-pointer overflow-hidden rounded-[16px] bg-[#18181d] transition-all duration-200 hover:scale-[1.02]"
                  >
                    {video.poster ? (
                      <img src={video.poster} alt={video.title || 'Video'} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-purple-900/20 text-[#a78bfa] text-[24px]">
                        ▶
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-[#09090b]/80 via-[#09090b]/20 to-transparent opacity-90" />
                    <div className="absolute bottom-3 left-3 right-3 space-y-1">
                      <p className="line-clamp-2 text-[11px] font-semibold leading-tight text-[#f7f7f8]">
                        {video.description || video.title}
                      </p>
                      <p className="text-[9px] text-[#a78bfa] font-medium">@{video.creator.name}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Main browse sections */
          <>
            <div>
              <h3 className="mb-4 text-[18px] font-semibold">Topics</h3>
              <div className="flex flex-wrap gap-[10px]">
                {topics.map((topic) => (
                  <div
                    key={topic.label}
                    onClick={() => navigate(`/?tag=${topic.label}`)}
                    className="flex h-[90px] w-[112px] cursor-pointer flex-col justify-between rounded-[16px] px-3 py-3 transition-transform duration-150 active:scale-95 hover:brightness-110"
                    style={{ backgroundColor: topic.bg }}
                  >
                    <p className="text-[14px] font-semibold">#{topic.label}</p>
                    <p className="text-[10px] font-normal text-[#a1a1aa]">{topic.count}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4 pb-8">
              <h3 className="text-[18px] font-semibold">Trending creators</h3>
              <div className="flex flex-col gap-2">
                {creators.map((creator) => (
                  <TrendingCreatorRow
                    key={creator.pubkey}
                    creator={creator}
                    isFollowing={isFollowingPubkeys.has(creator.pubkey)}
                    session={session}
                    onFollow={handleFollow}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
