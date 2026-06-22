import React, { useState } from 'react'
import { Search } from 'lucide-react'

export const DiscoverPage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('')

  const topics = [
    { label: 'Technology', count: '12.4k videos', bg: '#241a38' },
    { label: 'Art', count: '8.1k videos', bg: '#30201d' },
    { label: 'Music', count: '6.2k videos', bg: '#162b2c' },
  ]

  const creators = [
    { name: '@maya', subtitle: 'City films', color: '#60a5fa' },
    { name: '@nora', subtitle: 'Generative art', color: '#f05252' },
    { name: '@kai', subtitle: 'Open web', color: '#31c48d' },
  ]

  return (
    <div className="flex min-h-full flex-col bg-[#09090b] px-4 pb-4 pt-4 text-[#f7f7f8]">
      <div className="flex h-[56px] items-center justify-between">
        <h2 className="text-[18px] font-bold">Discover</h2>
        <span className="text-[22px] text-[#f7f7f8]"> </span>
      </div>

      <div className="flex flex-1 flex-col gap-[18px]">
        <div className="flex items-center gap-3 rounded-[14px] bg-[#18181d] px-[14px] py-[12px] text-[#a1a1aa]">
          <Search className="h-4 w-4" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search creators, tags or notes"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-[#a1a1aa]"
          />
        </div>

        <div>
          <h3 className="mb-4 text-[18px] font-semibold">Topics</h3>
          <div className="flex gap-[10px]">
            {topics.map((topic) => (
              <div key={topic.label} className="flex h-[90px] w-[112px] flex-col gap-[5px] rounded-[16px] px-3 py-3" style={{ backgroundColor: topic.bg }}>
                <p className="text-[14px] font-semibold">{topic.label}</p>
                <p className="text-[10px] font-normal text-[#a1a1aa]">{topic.count}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-[18px] font-semibold">Trending creators</h3>
          {creators.map((creator) => (
            <div key={creator.name} className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div
                  className="flex size-[44px] items-center justify-center rounded-[22px] text-[15px] font-bold text-white"
                  style={{ backgroundColor: creator.color }}
                >
                  N
                </div>
                <div>
                  <p className="text-[14px] font-semibold">{creator.name}</p>
                  <p className="text-[11px] font-normal text-[#a1a1aa]">{creator.subtitle}</p>
                </div>
              </div>
              <button className="rounded-[11px] bg-[#18181d] px-[16px] py-[11px] text-[13px] font-semibold text-white">
                Follow
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
