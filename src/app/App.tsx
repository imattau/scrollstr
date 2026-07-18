import React, { Suspense, useState, useRef, useEffect, useCallback } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { AppRouter } from './router'
import { NostrProvider, useNostr } from './providers'
import { publishLike, publishBoost, publishFollow, parseVideoEvent } from '../nostr/events'
import { db, saveEventToCache, updateUserVideoState } from '../nostr/cache'
import { graph } from '../graph'
import { ToastProvider, useToast } from '../components/feedback/Toast'

const LoginSheet = React.lazy(() => import('../features/auth/LoginSheet').then(m => ({ default: m.LoginSheet })))
const CommentsSheet = React.lazy(() => import('../features/comments/CommentsSheet').then(m => ({ default: m.CommentsSheet })))
const ZapSheet = React.lazy(() => import('../features/zaps/ZapSheet').then(m => ({ default: m.ZapSheet })))
const SplashScreen = React.lazy(() => import('../features/splash/SplashScreen').then(m => ({ default: m.SplashScreen })))

function AppContent() {
  const { pool, signEvent, session } = useNostr()
  const { toast } = useToast()
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [isCommentsOpen, setIsCommentsOpen] = useState(false)
  const [isZapOpen, setIsZapOpen] = useState(false)
  
  // Scoped video variables for active sheets
  const [activeVideoId, setActiveVideoId] = useState('')
  const [activeCreatorPubkey, setActiveCreatorPubkey] = useState('')
  const [activeVideoKind, setActiveVideoKind] = useState<number | null>(null)
  const [pendingAction, setPendingAction] = useState<{ type: string; videoId: string; creatorPubkey?: string; videoKind?: number } | null>(null)
  // Keep a ref pointing at the latest handleActionTrigger so pending post-login
  // actions don't use a stale closure (session is null in the pre-login render).
  const handleActionTriggerRef = useRef<typeof handleActionTrigger>(null as any)
  const [activeVideo, setActiveVideo] = useState<any>(null)
  const [isMuted, setIsMuted] = useState(true)
  const [showSplash, setShowSplash] = useState(false)
  const isFirstRun = useRef(!localStorage.getItem('scrollstr_has_opened'))
  const loginSheetWasOpened = useRef(false)

  // Automatically prompt user to log in on initial page load if not authenticated (or after browser reset)
  React.useEffect(() => {
    const stored = localStorage.getItem('scrollstr_session')
    if (!stored && !session) {
      console.log('No existing session found on load/reset. Prompting login.')
      setIsLoginOpen(true)
    }
  }, [session])

  // Track when the login sheet is opened (for detecting guest dismissal on first run)
  useEffect(() => {
    if (isLoginOpen) {
      loginSheetWasOpened.current = true
    }
  }, [isLoginOpen])

  // Trigger splash on first run when the login sheet closes without a session (guest/dismissal)
  useEffect(() => {
    if (isFirstRun.current && loginSheetWasOpened.current && !isLoginOpen && !session) {
      setShowSplash(true)
    }
  }, [isLoginOpen, session])

  const handleActionTrigger = useCallback(async (actionType: string, videoId: string, creatorPubkey?: string, videoKind?: number) => {
    setActiveVideoId(videoId)
    setActiveVideoKind(videoKind ?? null)
    if (creatorPubkey) {
      setActiveCreatorPubkey(creatorPubkey)
    }

    // List of actions requiring authentication
    const requiresAuth = ['like', 'comment', 'boost', 'zap'].includes(actionType)

    if (requiresAuth && !session) {
      console.log(`Action '${actionType}' requires login. Opening Login Sheet.`)
      setPendingAction({ type: actionType, videoId, creatorPubkey, videoKind })
      setIsLoginOpen(true)
      return
    }

    // Authenticated actions execution
    if (actionType === 'comment') {
      setIsCommentsOpen(true)
    } else if (actionType === 'zap') {
      setIsZapOpen(true)
    } else if (actionType === 'like') {
      try {
        const signed = await publishLike(signEvent, videoId, creatorPubkey || '', videoKind ?? activeVideoKind ?? 22)
        await saveEventToCache(signed)
        await updateUserVideoState(videoId, { liked: true })
      } catch (err) {
        console.error('Like failed:', err)
        toast('Failed to publish Like', 'error')
      }
    } else if (actionType === 'boost') {
      try {
        const signed = await publishBoost(signEvent, videoId, creatorPubkey || '', videoKind ?? activeVideoKind ?? 22)
        await saveEventToCache(signed)
        await updateUserVideoState(videoId, { boosted: true })
      } catch (err) {
        console.error('Boost failed:', err)
        toast('Failed to publish Boost', 'error')
      }
    } else if (actionType === 'share') {
      try {
        const cached = await db.cachedEvents.get(videoId)
        const ev = cached?.event
        let videoUrl = ''
        if (ev) {
          const parsed = parseVideoEvent(ev)
          videoUrl = parsed?.url || ''
        }
        const textToCopy = videoUrl || (window.location.origin + `/video/${videoId}`)
        await navigator.clipboard.writeText(textToCopy)
        toast('Copied video link to clipboard!', 'success')
      } catch (err) {
        console.error('Failed to copy link:', err)
        toast('Failed to copy share link', 'error')
      }
    } else if (actionType === 'mute') {
      setIsMuted(!isMuted)
    } else {
      console.log(`Triggered guest action: ${actionType}`)
    }
  }, [session, signEvent, activeVideoKind, isMuted, toast])

  // Sync ref after commit so pending post-login actions use the latest closure.
  useEffect(() => {
    handleActionTriggerRef.current = handleActionTrigger
  })

  const handleSplashFinish = () => {
    setShowSplash(false)
    localStorage.setItem('scrollstr_has_opened', 'true')
  }

  const handleLoginSuccess = useCallback(() => {
    setIsLoginOpen(false)
    if (isFirstRun.current) {
      setShowSplash(true)
    }
    // Resume pending action if present
    if (pendingAction) {
      const { type, videoId, creatorPubkey, videoKind } = pendingAction
      setPendingAction(null)
      // Small timeout to let sheet close before launching next step
      // Use handleActionTriggerRef to avoid stale closure capturing a null session.
      setTimeout(() => {
        handleActionTriggerRef.current(type, videoId, creatorPubkey, videoKind)
      }, 300)
    }
  }, [pendingAction])

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-neutral-950 font-sans text-neutral-100">
        <Suspense fallback={<div className="flex items-center justify-center h-screen"><div className="size-9 animate-spin rounded-full border-2 border-[#27272a] border-t-[#8b5cf6]" /></div>}>
        <AppRouter 
          onActionTrigger={handleActionTrigger} 
          activeVideo={activeVideo}
          onVideoChange={setActiveVideo}
          isMuted={isMuted}
        />
        
        {/* Auth Sheets / Dialogs */}
        <LoginSheet
          isOpen={isLoginOpen}
          onClose={() => setIsLoginOpen(false)}
          onLoginSuccess={handleLoginSuccess}
        />

        {/* Comments bottom sheet */}
        <CommentsSheet
          isOpen={isCommentsOpen}
          videoId={activeVideoId}
          creatorPubkey={activeCreatorPubkey}
          onClose={() => setIsCommentsOpen(false)}
        />

        {/* Zap bottom sheet */}
        <ZapSheet
          isOpen={isZapOpen}
          videoId={activeVideoId}
          creatorPubkey={activeCreatorPubkey}
          onClose={() => setIsZapOpen(false)}
        />

        {showSplash && <SplashScreen onFinish={handleSplashFinish} />}
        </Suspense>
      </div>
    </BrowserRouter>
  )
}

function App() {
  useEffect(() => {
    graph.warm().catch((err) => console.warn('[App] Graph warm-up:', err))
  }, [])

  return (
    <NostrProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </NostrProvider>
  )
}

export default App
