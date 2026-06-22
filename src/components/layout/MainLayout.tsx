import React from 'react'
import { Link } from 'react-router-dom'
import { Home, Compass, PlusSquare, Bell, User, Settings, LogOut, Download } from 'lucide-react'
import { useNostr } from '../../app/providers'
import { usePWAInstall } from '../../pwa/usePWAInstall'

interface MainLayoutProps {
  children: React.ReactNode
  rightPanel?: React.ReactNode
  immersive?: boolean
  pathname: string
  feedType?: string
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children, rightPanel, immersive = false, pathname, feedType = 'explore' }) => {
  const { session, logout } = useNostr()
  const { isInstallable, installApp } = usePWAInstall()

  const navItems = [
    { path: '/', label: 'Home', icon: Home },
    { path: '/discover', label: 'Discover', icon: Compass },
    { path: '/post', label: 'Post', icon: PlusSquare },
    { path: '/activity', label: 'Activity', icon: Bell },
    { path: '/settings', label: 'Settings', icon: Settings },
  ]

  const mobileNavItems = [
    { path: '/', label: 'Home', icon: Home },
    { path: '/discover', label: 'Discover', icon: Compass },
    { path: '/post', label: 'Post', icon: PlusSquare },
    { path: '/activity', label: 'Activity', icon: Bell },
    { path: '/profile/me', label: 'Profile', icon: User },
  ]

  const isActive = (path: string) => {
    if (path === '/') {
      return pathname === '/'
    }
    return pathname.startsWith(path)
  }

  if (immersive) {
    return (
      <div className="min-h-dvh bg-[#09090b] text-[#f7f7f8] selection:bg-fuchsia-500 selection:text-white">
        <div className="md:hidden h-dvh overflow-hidden bg-[#1b1327] relative pb-16">
          {children}
          {/* Mobile Navigation (Bottom) */}
          <nav className="fixed bottom-0 left-0 right-0 h-16 bg-neutral-950/80 backdrop-blur-lg border-t border-neutral-900 flex items-center justify-around px-4 z-50">
            {mobileNavItems.map((item) => {
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
              );
            })}
          </nav>
        </div>

        <div className="hidden md:flex min-h-screen justify-center overflow-hidden bg-[#09090b]">
          <div className="flex h-screen w-full max-w-[1440px] overflow-hidden rounded-none">
            <aside className="flex w-[248px] shrink-0 flex-col justify-between border-r border-[#111115] bg-[#111115] p-6">
              <div className="space-y-8">
                <div className="space-y-2">
                  <div className="text-[18px] font-bold">NOSTR CLIPS</div>
                  <div className="text-[11px] text-[#a1a1aa]">Vertical video on the open web</div>
                </div>
                <nav className="space-y-1">
                  {navItems.map((item) => {
                    const Icon = item.icon
                    const active = isActive(item.path)
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        className={[
                          'flex items-center gap-3 rounded-[12px] px-3 py-3 text-[15px] transition-colors',
                          active ? 'bg-[#222228] font-semibold text-[#f7f7f8]' : 'text-[#a1a1aa]',
                        ].join(' ')}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span>{item.label}</span>
                      </Link>
                    )
                  })}
                </nav>
              </div>

              <div className="space-y-2">
                {isInstallable && (
                  <button
                    onClick={installApp}
                    className="flex w-full items-center gap-3 px-3 py-3 rounded-[12px] text-purple-400 hover:bg-[#222228] hover:text-purple-300 transition-colors text-left border border-purple-500/20"
                  >
                    <Download className="h-4 w-4" />
                    <span className="text-[15px]">Install App</span>
                  </button>
                )}
                <Link to="/profile/me" className="flex items-center gap-3 px-3 py-3 rounded-[12px] text-[#a1a1aa] hover:bg-[#222228] hover:text-[#f7f7f8] transition-colors">
                  <User className="h-4 w-4" />
                  <span className="text-[15px]">Profile</span>
                </Link>
                {session && (
                  <button
                    onClick={logout}
                    className="flex w-full items-center gap-3 px-3 py-3 rounded-[12px] text-red-400/80 hover:bg-red-500/10 hover:text-red-400 transition-colors text-left"
                  >
                    <LogOut className="h-4 w-4" />
                    <span className="text-[15px]">Logout</span>
                  </button>
                )}
              </div>
            </aside>

            <main className="flex h-screen w-[720px] shrink-0 flex-col overflow-hidden bg-[#09090b]">
              <div className="flex h-[68px] items-center justify-center">
                <div className="flex gap-2">
                  <Link
                    to="/?feed=following"
                    className={`rounded-[18px] px-[14px] py-[8px] text-[12px] font-semibold transition-colors ${
                      feedType === 'following'
                        ? 'bg-[#f7f7f8] text-[#09090b]'
                        : 'bg-[#18181d] text-[#f7f7f8] hover:bg-[#222228]'
                    }`}
                  >
                    Following
                  </Link>
                  <Link
                    to="/?feed=explore"
                    className={`rounded-[18px] px-[14px] py-[8px] text-[12px] font-semibold transition-colors ${
                      feedType === 'explore'
                        ? 'bg-[#f7f7f8] text-[#09090b]'
                        : 'bg-[#18181d] text-[#f7f7f8] hover:bg-[#222228]'
                    }`}
                  >
                    Explore
                  </Link>
                </div>
              </div>

              <div className="relative flex flex-1 justify-center overflow-hidden">
                {children}
              </div>
            </main>

            <aside className="flex w-[472px] shrink-0 flex-col overflow-y-auto bg-[#111115] p-6">
              {rightPanel || (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-[20px] font-bold text-[#f7f7f8]">Comments</h3>
                    <p className="mt-2 text-[12px] text-[#a1a1aa]">148 comments</p>
                  </div>
                  <div className="space-y-4">
                    {[
                      ['@nora', 'The reflections make this feel cinematic.', '#f05252'],
                      ['@kai', 'This is why open video matters.', '#31c48d'],
                      ['@jules', '⚡ 210 sats · Great shot', '#f05252'],
                      ['@nora', 'The reflections make this feel cinematic.', '#31c48d'],
                      ['@kai', 'This is why open video matters.', '#f05252'],
                    ].map(([name, text, accent]) => (
                      <div key={`${name}-${text}`} className="flex gap-3">
                        <div
                          className="flex size-[36px] shrink-0 items-center justify-center rounded-[18px] text-[12px] font-bold text-white"
                          style={{ backgroundColor: accent as string }}
                        >
                          N
                        </div>
                        <div>
                          <p className="text-[12px] font-medium text-[#a1a1aa]">{name}</p>
                          <p className="max-w-[330px] text-[13px] font-normal leading-normal text-[#f7f7f8]">{text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>
        </div>
      </div>
    )
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
          <div className="pt-4 border-t border-neutral-800 space-y-2">
            {isInstallable && (
              <button
                onClick={installApp}
                className="flex w-full items-center gap-3 px-4 py-2 rounded-xl text-purple-400 hover:bg-purple-500/10 hover:text-purple-300 transition-all duration-200 text-left font-medium border border-purple-500/20"
              >
                <Download className="w-5 h-5" />
                <span className="text-sm">Install App</span>
              </button>
            )}
            <Link
              to="/profile/me"
              className={`flex items-center gap-3 px-4 py-2 rounded-xl text-neutral-400 hover:text-neutral-100 transition-colors ${
                isActive('/profile/me') ? 'text-purple-400' : ''
              }`}
            >
              <User className="w-5 h-5" />
              <span className="text-sm font-medium">My Profile</span>
            </Link>
            {session && (
              <button
                onClick={logout}
                className="flex w-full items-center gap-3 px-4 py-2 rounded-xl text-red-400/80 hover:bg-red-500/10 hover:text-red-400 transition-colors text-left"
              >
                <LogOut className="w-5 h-5" />
                <span className="text-sm font-medium">Logout</span>
              </button>
            )}
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
        {mobileNavItems.map((item) => {
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
