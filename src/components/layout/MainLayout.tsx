import React, { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { Home, Compass, PlusSquare, Bell, User, Settings, LogOut, Download } from 'lucide-react'
import { useNostr } from '../../app/providers'
import { usePWAInstall } from '../../pwa/usePWAInstall'
import { usePWAUpdate } from '../../pwa/usePWAUpdate'

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

interface MainLayoutProps {
  children: React.ReactNode
  rightPanel?: React.ReactNode
  immersive?: boolean
  pathname: string
  feedType?: string
}

export const MainLayout = React.memo<MainLayoutProps>(({ children, rightPanel, immersive = false, pathname, feedType = 'explore' }) => {
  const { session, logout } = useNostr()
  const { isInstallable, installApp } = usePWAInstall()
  const { needRefresh, update, dismiss } = usePWAUpdate()

  const isActive = useCallback((path: string) => {
    if (path === '/') {
      return pathname === '/'
    }
    return pathname.startsWith(path)
  }, [pathname])

  return (
    <>
      {immersive ? (
        <div className="min-h-dvh bg-[#09090b] text-[#f7f7f8] selection:bg-fuchsia-500 selection:text-white">
        <div className="md:hidden h-dvh bg-[#1b1327] relative">
          <div className="absolute inset-0 bottom-16 overflow-hidden">
            {children}
          </div>
          {/* Mobile Navigation (Bottom) */}
          <nav className="absolute bottom-0 left-0 right-0 h-16 bg-neutral-950/80 backdrop-blur-lg border-t border-neutral-900 flex items-center justify-around px-4 z-50">
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
                  <span className="text-[10px] mt-1">{item.path === '/profile/me' ? (session ? 'My Profile' : 'Profile') : item.label}</span>
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
                  <div className="text-xl font-bold tracking-wide">NOSTR CLIPS</div>
                  <div className="text-xs text-[#a1a1aa]">Vertical video on the open web</div>
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
                          'flex items-center gap-4 rounded-xl px-4 py-3.5 text-base font-medium transition-colors',
                          active ? 'bg-[#222228] font-semibold text-[#f7f7f8]' : 'text-[#a1a1aa]',
                        ].join(' ')}
                      >
                        <Icon className="h-5 w-5 shrink-0" />
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
                    className="flex w-full items-center gap-4 px-4 py-3.5 rounded-xl text-purple-400 hover:bg-[#222228] hover:text-purple-300 transition-colors text-left border border-purple-500/20 text-base"
                  >
                    <Download className="h-5 w-5" />
                    <span>Install App</span>
                  </button>
                )}
                <Link to="/profile/me" className="flex items-center gap-4 px-4 py-3.5 rounded-xl text-[#a1a1aa] hover:bg-[#222228] hover:text-[#f7f7f8] transition-colors text-base">
                  <User className="h-5 w-5" />
                  <span>{session ? 'My Profile' : 'Profile'}</span>
                </Link>
                {session && (
                  <button
                    onClick={logout}
                    className="flex w-full items-center gap-4 px-4 py-3.5 rounded-xl text-red-400/80 hover:bg-red-500/10 hover:text-red-400 transition-colors text-left text-base"
                  >
                    <LogOut className="h-5 w-5" />
                    <span>Logout</span>
                  </button>
                )}
              </div>
            </aside>

            <main className="flex h-screen w-[720px] shrink-0 flex-col overflow-hidden bg-[#09090b]">
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
    ) : (
      <div className="h-dvh bg-neutral-950 text-neutral-100 flex flex-col selection:bg-purple-600 selection:text-white">
      {/* Mobile content area (takes remaining space, scrolls) */}
      <div className="flex-1 min-h-0 overflow-y-auto md:flex md:justify-center pb-16 md:pb-0">
        {/* Container */}
        <div className="w-full max-w-[1250px] md:flex">
          
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
                      className={`flex items-center gap-4 px-4 py-3.5 rounded-xl text-base font-medium transition-all duration-200 ${
                        active
                          ? 'bg-purple-600/10 text-purple-400 font-semibold'
                          : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100'
                      }`}
                    >
                      <Icon className="h-5 w-5" />
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
                  className="flex w-full items-center gap-4 px-4 py-3.5 rounded-xl text-purple-400 hover:bg-purple-500/10 hover:text-purple-300 transition-all duration-200 text-left font-medium border border-purple-500/20 text-base"
                >
                  <Download className="h-5 w-5" />
                  <span>Install App</span>
                </button>
              )}
              <Link
                to="/profile/me"
                className={`flex items-center gap-4 px-4 py-3.5 rounded-xl text-neutral-400 hover:text-neutral-100 transition-colors text-base font-medium ${
                  isActive('/profile/me') ? 'text-purple-400' : ''
                }`}
              >
                <User className="h-5 w-5" />
                <span>{session ? 'My Profile' : 'Profile'}</span>
              </Link>
              {session && (
                <button
                  onClick={logout}
                  className="flex w-full items-center gap-4 px-4 py-3.5 rounded-xl text-red-400/80 hover:bg-red-500/10 hover:text-red-400 transition-colors text-left text-base font-medium"
                >
                  <LogOut className="h-5 w-5" />
                  <span>Logout</span>
                </button>
              )}
            </div>
          </aside>

          {/* Main Content Area */}
          <main className="flex-1 flex justify-center overflow-y-auto">
            <div className="w-full max-w-[480px] bg-black border-x border-neutral-900 flex flex-col min-h-0">
              <div className="flex-1 min-h-0">
                {children}
              </div>
            </div>
          </main>

          {/* Desktop Sidebar (Right) */}
          <aside className="hidden lg:block w-80 p-6 border-l border-neutral-800 shrink-0 sticky top-0 h-screen overflow-y-auto bg-neutral-950/50">
            {rightPanel || (
              <div className="flex flex-col items-center justify-center h-full text-neutral-500 text-center">
                <span className="text-sm">Select a video to see comments and creator details</span>
              </div>
            )}
          </aside>
        </div>
      </div>

      {/* Mobile Navigation (Bottom) */}
      <nav className="fixed bottom-0 left-0 right-0 md:hidden h-16 bg-neutral-950/80 backdrop-blur-lg border-t border-neutral-900 flex items-center justify-around px-2 z-50">
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
              <span className="text-[10px] mt-1">{item.path === '/profile/me' ? (session ? 'My Profile' : 'Profile') : item.label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
    )}
    {needRefresh && (
      <div className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 md:bottom-6">
        <div className="flex items-center gap-3 rounded-full bg-[#18181d]/95 px-5 py-3 shadow-lg backdrop-blur-md border border-[#27272a]">
          <span className="text-[13px] text-[#f7f7f8] whitespace-nowrap">
            A new version is available
          </span>
          <button
            onClick={update}
            className="rounded-full bg-[#8b5cf6] px-4 py-1.5 text-[12px] font-semibold text-white hover:bg-[#7c3aed] active:scale-95 transition-all"
          >
            Reload
          </button>
          <button
            onClick={dismiss}
            className="text-[#71717a] hover:text-[#a1a1aa] text-[18px] leading-none"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      </div>
    )}
  </>
)
})
