import React, { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'

export const ProfilePage: React.FC = () => {
  const [activeTab] = useState<'videos' | 'boosts' | 'about'>('videos')

  const thumbnails = [
    '#20172c',
    '#16292e',
    '#30201d',
    '#16292e',
    '#30201d',
    '#20172c',
  ]

  return (
    <div className="flex min-h-full flex-col bg-[#09090b] px-4 pb-4 pt-4 text-[#f7f7f8]">
      <div className="flex h-[56px] items-center justify-between">
        <h2 className="text-[18px] font-bold">@maya</h2>
        <MoreHorizontal className="h-5 w-5" />
      </div>

      <div className="flex flex-col gap-[14px]">
        <div className="flex items-start gap-[14px]">
          <div className="flex size-[76px] items-center justify-center rounded-[38px] bg-[#60a5fa] text-[27px] font-bold text-white">
            N
          </div>
          <div className="flex gap-[24px]">
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[17px] font-bold">48</span>
              <span className="text-[10px] text-[#a1a1aa]">Videos</span>
            </div>
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[17px] font-bold">12k</span>
              <span className="text-[10px] text-[#a1a1aa]">Followers</span>
            </div>
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[17px] font-bold">321</span>
              <span className="text-[10px] text-[#a1a1aa]">Following</span>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-[18px] font-semibold">Maya Chen</h3>
          <p className="mt-2 text-[13px] font-normal leading-normal text-[#a1a1aa]">
            Small films about cities, rain and the open web.
            <br />
            melbourne.social
          </p>
        </div>

        <button className="h-[44px] rounded-[12px] bg-[#18181d] text-[14px] font-semibold text-white">
          Edit profile
        </button>

        <div className="flex h-[44px] items-start justify-between text-[13px]">
          <span className="font-semibold text-[#f7f7f8]">Videos</span>
          <span className="font-medium text-[#a1a1aa]">Boosts</span>
          <span className="font-medium text-[#a1a1aa]">About</span>
        </div>

        <div className="grid grid-cols-3 gap-1">
          {activeTab === 'videos' &&
            thumbnails.map((color, idx) => (
              <div key={`${color}-${idx}`} className="h-[174px] rounded-[8px]" style={{ backgroundColor: color }} />
            ))}
        </div>
      </div>
    </div>
  )
}
