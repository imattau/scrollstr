import React, { useState } from 'react'
import { Search, Compass, Tv } from 'lucide-react'

export const DiscoverPage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('')

  const TOPIC_TILES = [
    { id: 'nostr', label: '#nostr', count: 1200 },
    { id: 'coffee', label: '#coffee', count: 840 },
    { id: 'biking', label: '#biking', count: 430 },
    { id: 'travel', label: '#travel', count: 1900 },
    { id: 'music', label: '#music', count: 3200 },
    { id: 'bitcoin', label: '#bitcoin', count: 5400 },
  ]

  const TRENDING_CREATORS = [
    { pubkey: '1', name: 'alice', display: 'Alice Coffee', pic: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=60' },
    { pubkey: '2', name: 'bob', display: 'Bob Trails', pic: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=60' },
    { pubkey: '3', name: 'charlie', display: 'Charlie Dev', pic: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&auto=format&fit=crop&q=60' },
  ]

  return (
    <div className="p-4 space-y-6">
      {/* Search Bar */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search creators, hashtags, text..."
          className="w-full bg-neutral-900 border border-neutral-800 rounded-xl py-3 pl-10 pr-4 text-sm text-neutral-200 focus:outline-none focus:border-purple-500 transition-colors"
        />
        <Search className="absolute left-3 top-3.5 w-4 h-4 text-neutral-500" />
      </div>

      {/* Topics */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider">Popular Topics</h3>
        <div className="grid grid-cols-2 gap-2">
          {TOPIC_TILES.map((topic) => (
            <div
              key={topic.id}
              className="p-4 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 hover:border-purple-500/30 rounded-2xl cursor-pointer transition-all duration-200 group"
            >
              <span className="font-bold text-neutral-200 group-hover:text-purple-400 block transition-colors">
                {topic.label}
              </span>
              <span className="text-[10px] text-neutral-500 mt-1 block">
                {topic.count} zaps today
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Trending Creators */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider">Trending Creators</h3>
        <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-none">
          {TRENDING_CREATORS.map((creator) => (
            <div key={creator.pubkey} className="flex flex-col items-center gap-1.5 shrink-0 cursor-pointer">
              <img
                src={creator.pic}
                alt={creator.name}
                className="w-14 h-14 rounded-full border-2 border-purple-600/30 hover:border-purple-500 transition-colors bg-neutral-850 p-0.5 object-cover"
              />
              <span className="text-[11px] font-semibold text-neutral-200">@{creator.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Videos Grid */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider">Recent Videos</h3>
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3, 4, 5, 6].map((idx) => (
            <div
              key={idx}
              className="aspect-[9/16] bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden relative group cursor-pointer hover:border-purple-500/40 transition-colors"
            >
              <img
                src={`https://images.unsplash.com/photo-1541614101331-1a5a3a194e92?w=200&auto=format&fit=crop&q=60&sig=${idx}`}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                alt="thumbnail"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-2">
                <span className="text-[9px] font-semibold text-neutral-300">⚡️ 2.4k</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
