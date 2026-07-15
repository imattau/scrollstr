import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Fuse from 'fuse.js'
import { Search, RotateCw } from 'lucide-react'
import { useNostr } from '../../app/providers'
import { useToast } from '../../components/feedback/Toast'
import { subscribeToRelays, searchRelays, addDiscoveredRelays, fetchRelayDirectory } from '../../nostr/pool'
import { DEFAULT_SEARCH_LIMIT } from '../../nostr/search-relays'
import { db, VideoShape, saveEventToCache } from '../../nostr/cache'
import { useLiveQuery } from '../../graph'
import { VideoItemData } from '../feed/VideoFeedItem'
import { useProfile } from '../../nostr/profile'
import { publishFollow } from '../../nostr/events'
import { useNavigate } from 'react-router-dom'
import { useUserRelayUrls } from '../../nostr/relays'
import { useMuteList } from '../../nostr/useMuteList'
import { useSimilarVideos } from './useSimilarVideos'

const EMPTY_VIDEOS: any[] = []
const VIDEO_KINDS = [1, 21, 22, 34236]
const MAX_SEARCH_RESULTS = 200
const MAX_SEARCH_PAGES = 10

function imetaValue(imetaTag: string[], key: string): string | undefined {
  for (const entry of imetaTag) {
    if (entry.startsWith(key + ' ')) return entry.slice(key.length + 1)
  }
}

function eventToVideoItem(event: any): VideoItemData | null {
  const imetaTag = event.tags?.find((t: string[]) => t[0] === 'imeta')
  let videoUrl = ''
  let poster = ''
  if (imetaTag) {
    videoUrl = imetaValue(imetaTag, 'url') ?? ''
    poster = imetaValue(imetaTag, 'image') ?? ''
  }
  if (!videoUrl) {
    const urlTag = event.tags?.find((t: string[]) => t[0] === 'url')
    if (urlTag) videoUrl = urlTag[1]
  }
  if (!videoUrl) {
    const urlMatch = event.content?.match(/(https?:\/\/[^\s]+)\.(mp4|webm|mov)/i)
    if (urlMatch) videoUrl = urlMatch[0]
  }
  if (!videoUrl) return null

  const titleTag = event.tags?.find((t: string[]) => t[0] === 'title')
  const altTag = event.tags?.find((t: string[]) => t[0] === 'alt')

  return {
    id: event.id,
    kind: event.kind,
    createdAt: event.created_at,
    title: titleTag?.[1] ?? '',
    description: event.content ?? altTag?.[1] ?? '',
    url: videoUrl,
    poster,
    creator: {
      pubkey: event.pubkey,
      name: event.pubkey.slice(0, 8),
    },
    hashtags: event.tags?.filter((t: string[]) => t[0] === 't').map((t: string[]) => t[1]) ?? [],
    likesCount: 0,
    commentsCount: 0,
    boostsCount: 0,
    zapsCount: 0,
    music: 'Original Clip Audio',
  }
}

const TrendingCreatorRow: React.FC<{
  creator: { pubkey: string; name: string; subtitle: string; color: string }
  isFollowing: boolean
  session: any
  onFollow: (pubkey: string) => void
  refreshKey?: number
}> = ({ creator, isFollowing, session, onFollow, refreshKey }) => {
  const navigate = useNavigate()
  const profile = useProfile(creator.pubkey, refreshKey)
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
  const { toast } = useToast()
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [isSearchingRelays, setIsSearchingRelays] = useState(false)
  const [accumulatedResults, setAccumulatedResults] = useState<VideoItemData[]>([])
  const [searchCursor, setSearchCursor] = useState<number | undefined>(undefined)
  const [isSearchExhausted, setIsSearchExhausted] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const processedRelayListIds = useRef(new Set<string>())
  const processedSearchPubkeys = useRef(new Set<string>())
  const seenSearchIds = useRef(new Set<string>())
  const searchPageCount = useRef(0)
  const searchResultCache = useRef(new Map<string, { results: VideoItemData[]; cursor: number | undefined }>())

  // Clear the refresh-state timer on unmount so it can't fire setState
  // after the component is gone.
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = undefined
      }
    }
  }, [])
  const relayUrls = useUserRelayUrls(session?.pubkey)
  const { mutedPubkeys, mutedHashtags } = useMuteList(session?.pubkey)

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
  }, [relayUrls, refreshKey])

  useEffect(() => {
    if (!relayUrls.length || !cacheSeemsStale) return
    const unsub = subscribeToRelays(relayUrls, {
      kinds: VIDEO_KINDS,
      limit: 100,
    })
    return () => unsub()
  }, [relayUrls, cacheSeemsStale, refreshKey])

  // Warm the relay directory cache on mount so search benefits from
  // discovered search-capable relays without blocking the first query.
  useEffect(() => {
    fetchRelayDirectory()
  }, [])

  // Watch for kind:10002 relay-list events arriving in the Dexie cache
  // (from backfill, profile subscriptions, bootstrap, etc.) and feed them
  // into the search relay pool for future queries.
  // Use created_at index with a hard limit so we don't load every cached
  // event into memory on every liveQuery re-fire.
  const rawRelayListEvents = useLiveQuery(
    () => db.cachedEvents
      .orderBy('created_at')
      .reverse()
      .limit(500)
      .toArray()
      .then(events => events.filter(e => e.kind === 10002).slice(0, 200)),
    []
  )
  const relayListEvents = useMemo(() => rawRelayListEvents ?? [], [rawRelayListEvents])

  useEffect(() => {
    const events = relayListEvents as any[]
    for (const ev of events) {
      if (processedRelayListIds.current.has(ev.id)) continue
      processedRelayListIds.current.add(ev.id)
      const tags: string[][] = ev.event?.tags ?? []
      const urls = tags.filter((t: string[]) => t[0] === 'r').map((t: string[]) => t[1])
      if (urls.length > 0) {
        console.log('[Discover] Discovered relays from kind:10002:', urls)
        addDiscoveredRelays(urls)
      }
    }
  }, [relayListEvents])

  // Subscribe to kind:10002 for authors encountered in search results so their
  // relay lists can expand the search pool for subsequent queries.
  useEffect(() => {
    if (!relayUrls.length) return

    const pubkeys: string[] = []
    for (const item of accumulatedResults) {
      const pk = item.creator.pubkey
      if (pk.startsWith('mock-')) continue
      if (processedSearchPubkeys.current.has(pk)) continue
      processedSearchPubkeys.current.add(pk)
      pubkeys.push(pk)
    }
    if (pubkeys.length === 0) return

    console.log('[Discover] Subscribing to kind:10002 for', pubkeys.length, 'search result authors')
    const unsub = subscribeToRelays(relayUrls, {
      kinds: [10002],
      authors: pubkeys,
      limit: 1,
    })
    return () => unsub()
  }, [accumulatedResults, relayUrls])

  // Query video shapes from the Dexie cache — bounded to avoid loading
  // thousands of cached shapes into memory on every liveQuery re-fire.
  const rawVideoShapes = useLiveQuery(
    () => db.videoShapes
      .orderBy('insertOrder')
      .reverse()
      .limit(1000)
      .toArray()
      .then(shapes => shapes.filter(s => s.videoUrl && s.mediaStatus !== 'failed')),
    []
  ) ?? EMPTY_VIDEOS

  // Query recent video shapes (last 48 hours) — for trending creators.
  // Use created_at index with a hard limit so it stays memory-bounded.
  const rawRecentVideoShapes = useLiveQuery(
    () => db.videoShapes
      .where('created_at')
      .above(Math.floor(Date.now() / 1000) - 48 * 3600)
      .limit(1000)
      .toArray()
      .then(shapes => shapes.filter(s => s.videoUrl && s.mediaStatus !== 'failed').slice(0, 500)),
    []
  ) ?? EMPTY_VIDEOS

  const mapShapeToVideoItem = (shape: VideoShape): VideoItemData => ({
    id: shape.id,
    kind: 22,
    createdAt: shape.created_at,
    title: shape.title ?? '',
    description: shape.summary ?? '',
    url: shape.videoUrl ?? '',
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
  })

  // Map shapes to local format (full cache — for search and topics)
  const videos = useMemo(() => {
    const list = (rawVideoShapes as VideoShape[]).map(mapShapeToVideoItem)
    if (mutedPubkeys.size === 0) return list
    return list.filter(v => !mutedPubkeys.has(v.creator.pubkey))
  }, [rawVideoShapes, mutedPubkeys])

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
    let mapped = (rawRecentVideoShapes as VideoShape[]).map(mapShapeToVideoItem)
    if (mutedPubkeys.size > 0) {
      mapped = mapped.filter(v => !mutedPubkeys.has(v.creator.pubkey))
    }
    const sorted = mapped.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    return sorted.slice(0, 300)
  }, [rawRecentVideoShapes, mutedPubkeys])

  // Vector-similar videos based on the top cached video
  const referenceVideo = (videos as VideoItemData[])?.[0]
  const similarVideos = useSimilarVideos(referenceVideo?.id, 8, 0.35)

  // Extract unique hashtags/topics dynamically from all videos
  const topics = useMemo(() => {
    const counts: Record<string, number> = {}
    videos.forEach((v) => {
      v.hashtags?.forEach((tag) => {
        const normalized = tag.toLowerCase()
        if (mutedHashtags.has(normalized)) return
        counts[normalized] = (counts[normalized] || 0) + 1
      })
    })

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

    return compiled
  }, [videos, mutedHashtags])

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
          kinds: [0, 10002],
          authors: uncached,
          limit: 2,
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
  const myContactListEvent = (myContactListEvents as any[]).toSorted((a: any, b: any) => b.created_at - a.created_at)[0]

  const isFollowingPubkeys = useMemo(() => {
    if (!myContactListEvent?.event) return new Set<string>()
    return new Set(
      myContactListEvent.event.tags
        .filter((t: any) => t[0] === 'p')
        .map((t: any) => t[1])
    )
  }, [myContactListEvent])

  // Debounce search input before running expensive Fuse.js search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Search relays via NIP-50 when debounced query changes (or when paginating)
  useEffect(() => {
    if (!debouncedSearch.trim() || !relayUrls.length) {
      setAccumulatedResults([])
      setSearchCursor(undefined)
      setIsSearchExhausted(false)
      setIsSearchingRelays(false)
      return
    }

    const cached = searchResultCache.current.get(debouncedSearch)
    if (cached) {
      setAccumulatedResults(cached.results)
      setSearchCursor(cached.cursor)
      setIsSearchExhausted(!cached.cursor)
      setIsSearchingRelays(false)
      return
    }

    setAccumulatedResults([])
    setSearchCursor(undefined)
    setIsSearchExhausted(false)
    seenSearchIds.current = new Set()
    searchPageCount.current = 0
    const controller = new AbortController()
    setIsSearchingRelays(true)

    console.log('[Search] Dispatching relay search:', debouncedSearch, 'relays:', relayUrls)
    searchRelays(relayUrls, debouncedSearch, { kinds: VIDEO_KINDS, limit: DEFAULT_SEARCH_LIMIT, signal: controller.signal })
      .then(async (events) => {
        if (controller.signal.aborted) return
        console.log('[Search] Received', events.length, 'events from relays')
        const items: VideoItemData[] = []
        for (const event of events) {
          if (controller.signal.aborted) return
          seenSearchIds.current.add(event.id)
          try { await saveEventToCache(event) } catch { /* best-effort */ }
          const item = eventToVideoItem(event)
          if (item) items.push(item)
        }
        console.log('[Search] Produced', items.length, 'VideoItemData items')
        if (!controller.signal.aborted) {
          setAccumulatedResults(items)
          if (events.length >= DEFAULT_SEARCH_LIMIT) {
            const oldest = Math.min(...events.map((e: any) => e.created_at))
            setSearchCursor(oldest - 1)
          } else {
            setIsSearchExhausted(true)
          }
        }
      })
      .catch((err) => {
        console.error('[Search] Relay search failed:', err)
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsSearchingRelays(false)
      })

    return () => controller.abort()
  }, [debouncedSearch, relayUrls])

  // Build a bounded search corpus: exclude mock events, limit to most recent
  const searchCorpus = useMemo(() => {
    const filtered = videos.filter(v => !v.creator.pubkey.startsWith('mock-'))
    const sorted = filtered.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    return sorted.slice(0, MAX_SEARCH_RESULTS).map(v => ({
      ...v,
      displayName: authorProfileMap[v.creator.pubkey]?.displayName ?? '',
      nip05: authorProfileMap[v.creator.pubkey]?.nip05 ?? '',
    }))
  }, [videos, authorProfileMap])

  const filteredVideos = useMemo(() => {
    if (!debouncedSearch.trim()) return []
    if (searchCorpus.length === 0) return []
    const fuse = new Fuse(searchCorpus, {
      keys: [
        { name: 'title', weight: 0.3 },
        { name: 'description', weight: 0.2 },
        { name: 'hashtags', weight: 0.4 },
        { name: 'creator.name', weight: 0.5 },
        { name: 'creator.pubkey', weight: 0.1 },
        { name: 'displayName', weight: 0.5 },
        { name: 'nip05', weight: 0.1 },
      ],
      threshold: 0.4,
    })
    return fuse.search(debouncedSearch).map(r => r.item)
  }, [debouncedSearch, searchCorpus])

  // Merge relay results (first) with local Fuse results, dedup by id
  const combinedResults = useMemo(() => {
    const seen = new Set<string>()
    const merged: VideoItemData[] = []
    for (const item of accumulatedResults) {
      if (!seen.has(item.id)) { seen.add(item.id); merged.push(item) }
    }
    for (const item of filteredVideos) {
      if (!seen.has(item.id)) { seen.add(item.id); merged.push(item) }
    }
    return merged
  }, [accumulatedResults, filteredVideos])

  // Cache search results so returning to a previous query is instant
  // Evicts oldest entries when cache exceeds 50 queries
  useEffect(() => {
    if (!debouncedSearch.trim() || accumulatedResults.length === 0) return
    const cache = searchResultCache.current
    cache.set(debouncedSearch, {
      results: accumulatedResults,
      cursor: searchCursor,
    })
    if (cache.size > 50) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
  }, [debouncedSearch, accumulatedResults, searchCursor])

  const handleLoadMore = useCallback(async () => {
    if (!debouncedSearch.trim() || !relayUrls.length || isLoadingMore || isSearchExhausted || !searchCursor) return

    if (searchPageCount.current >= MAX_SEARCH_PAGES) {
      setIsSearchExhausted(true)
      return
    }

    setIsLoadingMore(true)

    try {
      console.log('[Search] Loading more before ts', searchCursor)
      const events = await searchRelays(relayUrls, debouncedSearch, {
        kinds: VIDEO_KINDS,
        limit: DEFAULT_SEARCH_LIMIT,
        until: searchCursor,
      })

      console.log('[Search] Load more received', events.length, 'events')
      const items: VideoItemData[] = []
      for (const event of events) {
        seenSearchIds.current.add(event.id)
        try { await saveEventToCache(event) } catch { /* best-effort */ }
        const item = eventToVideoItem(event)
        if (item) items.push(item)
      }

      searchPageCount.current += 1
      const reachedPageLimit = searchPageCount.current >= MAX_SEARCH_PAGES

      setAccumulatedResults(prev => {
        if (reachedPageLimit || prev.length + items.length >= MAX_SEARCH_RESULTS) {
          setIsSearchExhausted(true)
        }
        const seen = new Set(prev.map(i => i.id))
        const newItems = items.filter(i => !seen.has(i.id))
        return [...prev, ...newItems].slice(0, MAX_SEARCH_RESULTS)
      })

      if (events.length < DEFAULT_SEARCH_LIMIT || reachedPageLimit) {
        setIsSearchExhausted(true)
      } else if (events.length > 0) {
        const oldest = Math.min(...events.map((e: any) => e.created_at))
        setSearchCursor(oldest - 1)
      }
    } catch (err) {
      console.error('[Search] Load more failed:', err)
    } finally {
      setIsLoadingMore(false)
    }
  }, [debouncedSearch, relayUrls, searchCursor, isLoadingMore, isSearchExhausted])

  const handleFollow = useCallback(async (targetPubkey: string) => {
    if (!session) {
      toast('Please connect your Nostr account to follow creators', 'info')
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
      toast('Failed to update follow status', 'error')
    }
  }, [session, signEvent, myContactListEvent])

  return (
    <div className="flex min-h-full flex-col bg-[#09090b] px-4 pb-4 pt-4 text-[#f7f7f8]">
      <div className="flex h-[56px] items-center justify-between">
        <h2 className="text-[18px] font-bold">Discover</h2>
        <button
          onClick={() => {
            setRefreshKey(k => k + 1)
            setCacheSeemsStale(true)
            setIsRefreshing(true)
            clearTimeout(refreshTimerRef.current)
            refreshTimerRef.current = setTimeout(() => setIsRefreshing(false), 1500)
          }}
          className="text-neutral-400 hover:text-white p-1 transition-colors"
          title="Refresh discover feed"
        >
          <RotateCw className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
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
                Search Results ({combinedResults.length})
                {isSearchingRelays && (
                  <span className="ml-2 text-[12px] font-normal text-[#a78bfa]">· searching network...</span>
                )}
              </h3>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-[12px] font-semibold text-[#a78bfa] hover:underline"
              >
                Clear
              </button>
            </div>
            {combinedResults.length === 0 ? (
              <p className="text-[13px] text-[#71717a] py-6 text-center">
                {isSearchingRelays
                  ? 'Searching network for matching videos...'
                  : 'No videos or creators matched your search.'}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 pb-8">
                  {combinedResults.map((video) => (
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
                {!isSearchExhausted && (
                  <div className="flex justify-center pb-8">
                    <button
                      type="button"
                      onClick={handleLoadMore}
                      disabled={isLoadingMore}
                      className="rounded-[11px] bg-[#18181d] px-6 py-3 text-[13px] font-semibold text-white transition-all duration-150 hover:bg-[#25252b] active:scale-95 disabled:opacity-50"
                    >
                      {isLoadingMore ? 'Loading more...' : 'Load more'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          /* Main browse sections */
          <>
            {topics.length > 0 && (
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
            )}

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
                    refreshKey={refreshKey}
                  />
                ))}
              </div>
            </div>

            {similarVideos.length > 0 && (
              <div className="space-y-4 pb-8">
                <h3 className="text-[18px] font-semibold">Similar to top video</h3>
                <div className="grid grid-cols-2 gap-3">
                  {similarVideos.map((video) => (
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
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
