import React, { useState } from 'react'
import { CheckCircle, Share2, Grid, Heart, Repeat } from 'lucide-react'

export const ProfilePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'videos' | 'boosts' | 'likes'>('videos')

  const profile = {
    name: 'captain_ocean',
    displayName: 'Captain Ocean',
    picture: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=60',
    nip05: 'ocean@nostr.com',
    about: 'Sailing enthusiast, surfer, and content creator sharing beautiful ocean loops. Web of Trust advocate.',
    pubkey: 'npub1captainocean...',
    followersCount: 3400,
    followingCount: 420,
  }

  return (
    <div className="bg-neutral-950 min-h-full">
      {/* Banner / Cover */}
      <div className="h-28 bg-gradient-to-r from-purple-900 to-pink-900 relative">
        <button className="absolute top-4 right-4 p-2 bg-black/40 backdrop-blur-md rounded-full text-white hover:bg-black/60 transition-colors">
          <Share2 className="w-4 h-4" />
        </button>
      </div>

      {/* Profile Details Container */}
      <div className="px-4 pb-6 space-y-4 relative">
        
        {/* Avatar (Overlapping banner) */}
        <div className="flex justify-between items-end -mt-10">
          <img
            src={profile.picture}
            alt={profile.displayName}
            className="w-20 h-20 rounded-full border-4 border-black object-cover"
          />
          <button className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-xl transition-colors shadow-lg shadow-purple-650/20">
            Follow
          </button>
        </div>

        {/* Text Metadata */}
        <div>
          <div className="flex items-center gap-1.5">
            <h2 className="text-lg font-bold text-white">{profile.displayName}</h2>
            <CheckCircle className="w-4 h-4 fill-purple-500 text-black" />
          </div>
          <span className="text-xs text-purple-400 font-semibold block">@{profile.name}</span>
          <span className="text-[10px] text-neutral-500 block mt-0.5">{profile.nip05}</span>
        </div>

        {/* Bio */}
        <p className="text-xs text-neutral-300 leading-relaxed">{profile.about}</p>

        {/* Stats */}
        <div className="flex gap-4 text-xs font-semibold text-neutral-400">
          <div>
            <span className="text-white">{profile.followingCount}</span> Following
          </div>
          <div>
            <span className="text-white">{profile.followersCount}</span> Followers
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-900">
        <button
          onClick={() => setActiveTab('videos')}
          className={`flex-1 py-3 text-xs font-bold flex justify-center items-center gap-2 border-b-2 transition-all ${
            activeTab === 'videos'
              ? 'border-purple-500 text-purple-400'
              : 'border-transparent text-neutral-500 hover:text-neutral-300'
          }`}
        >
          <Grid className="w-3.5 h-3.5" />
          <span>Clips</span>
        </button>
        <button
          onClick={() => setActiveTab('boosts')}
          className={`flex-1 py-3 text-xs font-bold flex justify-center items-center gap-2 border-b-2 transition-all ${
            activeTab === 'boosts'
              ? 'border-purple-500 text-purple-400'
              : 'border-transparent text-neutral-500 hover:text-neutral-300'
          }`}
        >
          <Repeat className="w-3.5 h-3.5" />
          <span>Boosts</span>
        </button>
        <button
          onClick={() => setActiveTab('likes')}
          className={`flex-1 py-3 text-xs font-bold flex justify-center items-center gap-2 border-b-2 transition-all ${
            activeTab === 'likes'
              ? 'border-purple-500 text-purple-400'
              : 'border-transparent text-neutral-500 hover:text-neutral-300'
          }`}
        >
          <Heart className="w-3.5 h-3.5" />
          <span>Likes</span>
        </button>
      </div>

      {/* Grid Content */}
      <div className="grid grid-cols-3 gap-1 p-1">
        {activeTab === 'videos' &&
          [1, 2, 3].map((idx) => (
            <div key={idx} className="aspect-[9/16] bg-neutral-900 border border-neutral-800 overflow-hidden relative group cursor-pointer">
              <img
                src={`https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=200&auto=format&fit=crop&q=60&sig=${idx}`}
                className="w-full h-full object-cover"
                alt="thumbnail"
              />
            </div>
          ))}
        {activeTab === 'boosts' && (
          <div className="col-span-3 text-center py-10 text-xs text-neutral-500">
            No boosted videos yet.
          </div>
        )}
        {activeTab === 'likes' && (
          <div className="col-span-3 text-center py-10 text-xs text-neutral-500">
            Likes are private by default.
          </div>
        )}
      </div>
    </div>
  )
}
