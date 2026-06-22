import React, { useState } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { AppRouter } from './router'
import { LoginSheet } from '../features/auth/LoginSheet'
import { CommentsSheet } from '../features/comments/CommentsSheet'
import { ZapSheet } from '../features/zaps/ZapSheet'
import { NostrProvider, useNostr } from './providers'
import { publishLike, publishBoost, publishFollow } from '../nostr/events/reactions'
import { parseVideoEvent } from '../nostr/events/video'

function AppContent() {
  const { rxNostr, signEvent, session, eventStore } = useNostr()
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [isCommentsOpen, setIsCommentsOpen] = useState(false)
  const [isZapOpen, setIsZapOpen] = useState(false)
  
  // Scoped video variables for active sheets
  const [activeVideoId, setActiveVideoId] = useState('')
  const [activeCreatorPubkey, setActiveCreatorPubkey] = useState('')
  const [activeVideoKind, setActiveVideoKind] = useState<number | null>(null)
  const [pendingAction, setPendingAction] = useState<{ type: string; videoId: string; videoKind?: number } | null>(null)
  const [activeVideo, setActiveVideo] = useState<any>(null)
  const [isMuted, setIsMuted] = useState(true)

  const handleActionTrigger = async (actionType: string, videoId: string, creatorPubkey?: string, videoKind?: number) => {
    setActiveVideoId(videoId)
    setActiveVideoKind(videoKind ?? null)
    if (creatorPubkey) {
      setActiveCreatorPubkey(creatorPubkey)
    }

    // List of actions requiring authentication
    const requiresAuth = ['like', 'comment', 'boost', 'zap', 'follow'].includes(actionType)

    if (requiresAuth && !session) {
      console.log(`Action '${actionType}' requires login. Opening Login Sheet.`)
      setPendingAction({ type: actionType, videoId, videoKind })
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
        const signed = await publishLike(signEvent, rxNostr, videoId, creatorPubkey || '', videoKind ?? activeVideoKind ?? 22)
        eventStore.add(signed)
      } catch (err) {
        console.error('Like failed:', err)
        alert('Failed to publish Like: ' + err)
      }
    } else if (actionType === 'boost') {
      try {
        const signed = await publishBoost(signEvent, rxNostr, videoId, creatorPubkey || '', videoKind ?? activeVideoKind ?? 22)
        eventStore.add(signed)
      } catch (err) {
        console.error('Boost failed:', err)
        alert('Failed to publish Boost: ' + err)
      }
    } else if (actionType === 'follow') {
      if (!session) {
        alert('Please log in to follow creators')
        return
      }
      try {
        const currentContactListEvent = eventStore.getByFilters({
          kinds: [3],
          authors: [session.pubkey],
        })?.[0]

        const { signed, action } = await publishFollow(
          signEvent,
          rxNostr,
          creatorPubkey || '',
          currentContactListEvent || null
        )

        eventStore.add(signed)
        alert(action === 'follow' ? 'Followed creator on Nostr!' : 'Unfollowed creator on Nostr!')
      } catch (err: any) {
        console.error('Follow action failed:', err)
        alert('Failed to update follow list: ' + (err.message || err))
      }
    } else if (actionType === 'share') {
      try {
        const evs = eventStore.getByFilters({ ids: [videoId] })
        const ev = evs[0]
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

  const handleLoginSuccess = () => {
    setIsLoginOpen(false)
    // Resume pending action if present
    if (pendingAction) {
      const { type, videoId, videoKind } = pendingAction
      setPendingAction(null)
      // Small timeout to let sheet close before launching next step
      setTimeout(() => {
        handleActionTrigger(type, videoId, activeCreatorPubkey, videoKind)
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
