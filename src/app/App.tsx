import React, { useState, useRef, useEffect } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { AppRouter } from './router'
import { LoginSheet } from '../features/auth/LoginSheet'
import { CommentsSheet } from '../features/comments/CommentsSheet'
import { ZapSheet } from '../features/zaps/ZapSheet'
import { NostrProvider, useNostr } from './providers'
import { publishLike, publishBoost, publishFollow, parseVideoEvent } from '../nostr/events'
import { db, saveEventToCache } from '../nostr/cache'

function AppContent() {
  const { pool, signEvent, session } = useNostr()
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

  // Automatically prompt user to log in on initial page load if not authenticated (or after browser reset)
  React.useEffect(() => {
    const stored = localStorage.getItem('scrollstr_session')
    if (!stored && !session) {
      console.log('No existing session found on load/reset. Prompting login.')
      setIsLoginOpen(true)
    }
  }, [session])

  const handleActionTrigger = async (actionType: string, videoId: string, creatorPubkey?: string, videoKind?: number) => {
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
      } catch (err) {
        console.error('Like failed:', err)
        alert('Failed to publish Like: ' + err)
      }
    } else if (actionType === 'boost') {
      try {
        const signed = await publishBoost(signEvent, videoId, creatorPubkey || '', videoKind ?? activeVideoKind ?? 22)
        await saveEventToCache(signed)
      } catch (err) {
        console.error('Boost failed:', err)
        alert('Failed to publish Boost: ' + err)
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
        alert('Copied video link to clipboard!')
      } catch (err) {
        console.error('Failed to copy link:', err)
        alert('Failed to copy share link: ' + err)
      }
    } else if (actionType === 'mute') {
      setIsMuted(!isMuted)
    } else {
      console.log(`Triggered guest action: ${actionType}`)
    }
  }

  // Sync ref after commit so pending post-login actions use the latest closure.
  useEffect(() => {
    handleActionTriggerRef.current = handleActionTrigger
  })

  const handleLoginSuccess = () => {
    setIsLoginOpen(false)
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
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-neutral-950 font-sans text-neutral-100">
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
      </div>
    </BrowserRouter>
  )
}

function App() {
  return (
    <NostrProvider>
      <AppContent />
    </NostrProvider>
  )
}

export default App
