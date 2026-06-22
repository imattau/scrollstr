import React, { useState } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { AppRouter } from './router'
import { LoginSheet } from '../features/auth/LoginSheet'
import { CommentsSheet } from '../features/comments/CommentsSheet'
import { ZapSheet } from '../features/zaps/ZapSheet'
import { NostrProvider, useNostr } from './providers'
import { publishLike, publishBoost } from '../nostr/events/reactions'

function AppContent() {
  const { ndk, session } = useNostr()
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [isCommentsOpen, setIsCommentsOpen] = useState(false)
  const [isZapOpen, setIsZapOpen] = useState(false)
  
  // Scoped video variables for active sheets
  const [activeVideoId, setActiveVideoId] = useState('')
  const [activeCreatorPubkey, setActiveCreatorPubkey] = useState('')
  const [pendingAction, setPendingAction] = useState<{ type: string; videoId: string } | null>(null)

  const handleActionTrigger = async (actionType: string, videoId: string, creatorPubkey?: string) => {
    setActiveVideoId(videoId)
    if (creatorPubkey) {
      setActiveCreatorPubkey(creatorPubkey)
    }

    // List of actions requiring authentication
    const requiresAuth = ['like', 'comment', 'boost', 'zap', 'follow'].includes(actionType)

    if (requiresAuth && !session) {
      console.log(`Action '${actionType}' requires login. Opening Login Sheet.`)
      setPendingAction({ type: actionType, videoId })
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
        await publishLike(ndk, videoId, creatorPubkey || '')
        alert('Liked video on Nostr!')
      } catch (err) {
        console.error('Like failed:', err)
        alert('Failed to publish Like: ' + err)
      }
    } else if (actionType === 'boost') {
      try {
        await publishBoost(ndk, videoId, creatorPubkey || '')
        alert('Boosted video on Nostr (reposted kind:16)!')
      } catch (err) {
        console.error('Boost failed:', err)
        alert('Failed to publish Boost: ' + err)
      }
    } else if (actionType === 'follow') {
      alert(`Follow pubkey ${creatorPubkey} simulated!`)
    } else {
      console.log(`Triggered guest action: ${actionType}`)
    }
  }

  const handleLoginSuccess = () => {
    setIsLoginOpen(false)
    // Resume pending action if present
    if (pendingAction) {
      const { type, videoId } = pendingAction
      setPendingAction(null)
      // Small timeout to let sheet close before launching next step
      setTimeout(() => {
        handleActionTrigger(type, videoId, activeCreatorPubkey)
      }, 300)
    }
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-neutral-950 font-sans text-neutral-100">
        <AppRouter onActionTrigger={handleActionTrigger} />
        
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
