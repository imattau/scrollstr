import React from 'react'
import { Heart, MessageCircle, Repeat2, Zap, UserPlus } from 'lucide-react'

interface NotificationItem {
  id: string
  type: 'like' | 'comment' | 'boost' | 'zap' | 'follow'
  user: {
    name: string
    avatar: string
  }
  time: string
  detail?: string
}

export const ActivityPage: React.FC = () => {
  const NOTIFICATIONS: NotificationItem[] = [
    { id: '1', type: 'zap', user: { name: 'alby_user', avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=60' }, time: '2m ago', detail: 'zapped 1,000 sats: "Incredible downhill edit!"' },
    { id: '2', type: 'like', user: { name: 'nostr_explorer', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=60' }, time: '15m ago' },
    { id: '3', type: 'comment', user: { name: 'coffee_lover', avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&auto=format&fit=crop&q=60' }, time: '1h ago', detail: 'commented: "Which beans did you use for this?"' },
    { id: '4', type: 'follow', user: { name: 'satoshi_99', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=60' }, time: '3h ago' },
    { id: '5', type: 'boost', user: { name: 'relay_wizard', avatar: 'https://images.unsplash.com/photo-1628157582853-a796fa650a6a?w=100&auto=format&fit=crop&q=60' }, time: '1d ago' },
  ]

  const getIcon = (type: string) => {
    switch (type) {
      case 'like':
        return <Heart className="w-4 h-4 text-red-500 fill-red-500" />
      case 'comment':
        return <MessageCircle className="w-4 h-4 text-purple-400 fill-purple-400/20" />
      case 'boost':
        return <Repeat2 className="w-4 h-4 text-green-400" />
      case 'zap':
        return <Zap className="w-4 h-4 text-yellow-450 fill-yellow-500" />
      case 'follow':
        return <UserPlus className="w-4 h-4 text-blue-400" />
      default:
        return null
    }
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-bold pb-2 border-b border-neutral-900">Activity</h2>

      <div className="divide-y divide-neutral-900">
        {NOTIFICATIONS.map((item) => (
          <div key={item.id} className="flex gap-3 py-4 items-start">
            
            {/* User Avatar + Icon Overlay */}
            <div className="relative">
              <img
                src={item.user.avatar}
                alt={item.user.name}
                className="w-10 h-10 rounded-full object-cover"
              />
              <div className="absolute -bottom-1 -right-1 bg-neutral-950 p-0.5 rounded-full border border-neutral-800">
                {getIcon(item.type)}
              </div>
            </div>

            {/* Notification content */}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-neutral-200">
                <span className="font-bold text-white">@{item.user.name}</span>{' '}
                {item.type === 'like' && 'liked your video'}
                {item.type === 'comment' && 'commented on your video'}
                {item.type === 'boost' && 'boosted your video'}
                {item.type === 'zap' && 'zapped your video'}
                {item.type === 'follow' && 'followed you'}
              </p>
              {item.detail && (
                <p className="text-[11px] text-neutral-400 mt-1 bg-neutral-900/45 p-2 rounded-lg truncate">
                  {item.detail}
                </p>
              )}
              <span className="text-[10px] text-neutral-500 mt-1 block">{item.time}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
