import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Home, Compass, PlusSquare, Bell, User, Settings } from 'lucide-react'

interface MainLayoutProps {
  children: React.ReactNode
  rightPanel?: React.ReactNode
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children, rightPanel }) => {
  const location = useLocation()

  const navItems = [
    { path: '/', label: 'Home', icon: Home },
    { path: '/discover', label: 'Discover', icon: Compass },
    { path: '/post', label: 'Post', icon: PlusSquare },
    { path: '/activity', label: 'Activity', icon: Bell },
    { path: '/settings', label: 'Settings', icon: Settings },
  ]

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/'
    }
    return location.pathname.startsWith(path)
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex justify-center selection:bg-purple-600 selection:text-white">
      {/* Container */}
      <div className="w-full max-w-[1250px] flex">
        
        {/* Desktop Sidebar (Left) */}
        <aside className="hidden md:flex flex-col justify-between w-64 p-6 border-r border-neutral-800 shrink-0 sticky top-0 h-screen">
          <div className="space-y-8">
            <div className="flex items-center gap-2 px-2">
              <span className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
                Nostr Clips
              </span>
            </div>

            <nav className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon
                const active = isActive(item.path)
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 ${
                      active
                        ? 'bg-purple-600/10 text-purple-400 font-medium'
                        : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </Link>
                )
              })}
            </nav>
          </div>

          {/* Quick Profile/Status in Sidebar */}
          <div className="pt-4 border-t border-neutral-800">
            <Link
              to="/profile/me"
              className={`flex items-center gap-3 px-4 py-2 rounded-xl text-neutral-400 hover:text-neutral-100 transition-colors ${
                isActive('/profile/me') ? 'text-purple-400' : ''
              }`}
            >
              <User className="w-5 h-5" />
              <span className="text-sm font-medium">My Profile</span>
            </Link>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex justify-center h-screen overflow-hidden relative">
          {/* Centered 9:16 Video player container or generic page container */}
          <div className="w-full max-w-[480px] bg-black border-x border-neutral-900 flex flex-col h-full relative">
            <div className="flex-1 overflow-y-auto scrollbar-none pb-16 md:pb-0">
              {children}
            </div>
          </div>
        </main>

        {/* Desktop Sidebar (Right) - e.g. Comments / Info */}
        <aside className="hidden lg:block w-80 p-6 border-l border-neutral-800 shrink-0 sticky top-0 h-screen overflow-y-auto bg-neutral-950/50">
          {rightPanel || (
            <div className="flex flex-col items-center justify-center h-full text-neutral-500 text-center">
              <span className="text-sm">Select a video to see comments and creator details</span>
            </div>
          )}
        </aside>
      </div>

      {/* Mobile Navigation (Bottom) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-neutral-950/80 backdrop-blur-lg border-t border-neutral-900 flex items-center justify-around px-4 z-50">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.path)
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center justify-center w-12 h-12 rounded-xl transition-colors ${
                active ? 'text-purple-400' : 'text-neutral-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] mt-1">{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
