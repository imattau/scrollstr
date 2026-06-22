import React from 'react'
import { Heart, MessageCircle, Repeat2, Zap, UserPlus } from 'lucide-react'

export const ActivityPage: React.FC = () => {
  const notifications = [
    { icon: <Zap className="h-5 w-5 text-[#f5b942]" />, text: '@nora zapped you 500 sats', time: '2m' },
    { icon: <Heart className="h-5 w-5 text-white" />, text: '@kai liked your video', time: '18m' },
    { icon: <Repeat2 className="h-5 w-5 text-white" />, text: '@jules boosted your video', time: '1h' },
    { icon: <MessageCircle className="h-5 w-5 text-white" />, text: '@maya commented: “Love this.”', time: '3h' },
    { icon: <UserPlus className="h-5 w-5 text-white" />, text: '@alex followed you', time: 'Yesterday' },
  ]

  return (
    <div className="flex min-h-full flex-col bg-[#09090b] px-4 pb-4 pt-4 text-[#f7f7f8]">
      <div className="flex h-[56px] items-center">
        <h2 className="text-[18px] font-bold">Activity</h2>
      </div>

      <div className="flex flex-1 flex-col gap-[4px]">
        {notifications.map((item, index) => (
          <div
            key={item.text}
            className={index === 0 ? 'flex h-[74px] items-center gap-3 bg-[#111115] px-4' : 'flex h-[74px] items-center gap-3 px-4'}
          >
            <div className="flex size-[42px] items-center justify-center rounded-[21px] bg-[#18181d]">
              {item.icon}
            </div>
            <div className="flex flex-col gap-1">
              <p className="w-[260px] text-[13px] font-medium leading-normal">{item.text}</p>
              <p className="text-[11px] font-normal text-[#71717a]">{item.time}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
