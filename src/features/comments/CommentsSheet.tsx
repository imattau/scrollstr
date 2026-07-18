import React, { useEffect, useState, useMemo } from 'react'
import { Drawer } from 'vaul'
import { useNostr } from '../../app/providers'
import { publishComment } from '../../nostr/events'
import { useToast } from '../../components/feedback/Toast'
import { subscribeToRelays } from '../../nostr/pool'
import { useUserRelayUrls } from '../../nostr/relays'
import { db, saveEventToCache } from '../../nostr/cache'
import { useLiveQuery } from '../../graph'
import { useProfile } from '../../nostr/profile'

const EMPTY_COMMENTS: any[] = []

interface CommentsSheetProps {
  isOpen: boolean
  videoId: string
  creatorPubkey: string
  onClose: () => void
}

const CommentRow: React.FC<{ comment: any }> = ({ comment }) => {
  const profile = useProfile(comment.pubkey)
  const avatarInitial = profile.displayName?.slice(0, 1).toUpperCase() || 'N'

  return (
    <div className="flex items-start gap-[10px] py-1.5 border-b border-[#23232a]/30">
      <div className="flex size-[36px] overflow-hidden shrink-0 items-center justify-center rounded-full bg-[#8b5cf6] text-[12px] font-bold text-white">
        {profile.picture ? (
          <img src={profile.picture} alt={profile.name} className="h-full w-full object-cover" />
        ) : (
          avatarInitial
        )}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-[12px] font-medium text-[#a1a1aa]">@{profile.displayName || profile.name}</p>
        <p className="w-[285px] text-[13px] font-normal leading-normal text-[#f7f7f8] break-words">{comment.content}</p>
        <p className="text-[11px] font-medium text-[#71717a]">
          {new Date(comment.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  )
}

export const CommentsSheet: React.FC<CommentsSheetProps> = ({ isOpen, videoId, creatorPubkey, onClose }) => {
  const { pool, session, signEvent } = useNostr()
  const { toast } = useToast()
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(false)
  const relayUrls = useUserRelayUrls(session?.pubkey)

  const rawComments = useLiveQuery(
    () => db.cachedEvents.where('eTags').equals(videoId).filter(e => e.kind === 1111).toArray(),
    [videoId]
  ) ?? EMPTY_COMMENTS

  useEffect(() => {
    if (!isOpen || !videoId) return

    setLoading(true)
    const sub = subscribeToRelays(relayUrls, { kinds: [1111], '#e': [videoId] })

    const timer = setTimeout(() => setLoading(false), 2000)

    return () => {
      sub()
      clearTimeout(timer)
    }
  }, [videoId, isOpen, relayUrls])

  const sortedComments = useMemo(() => {
    return [...rawComments].sort((a, b) => a.created_at - b.created_at)
  }, [rawComments])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputText.trim()) return
    if (!session) {
      toast('Please connect your Nostr account to comment', 'info')
      return
    }

    // Limit comment length to prevent relay spam and protocol abuse
    const trimmed = inputText.trim().slice(0, 5000)
    // Remove control characters except newlines
    // eslint-disable-next-line no-control-regex
    const sanitized = trimmed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')

    try {
      const newComment = await publishComment(signEvent, videoId, creatorPubkey, sanitized)
      await saveEventToCache(newComment)
      setInputText('')
    } catch (err) {
      console.error('Failed to post comment:', err)
      toast('Error posting comment', 'error')
    }
  }

  return (
    <Drawer.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/85" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 mx-auto flex h-[70vh] w-full max-w-[390px] flex-col overflow-hidden rounded-t-[28px] border border-[#2a2a31] bg-[#09090b] outline-none">
          <div className="flex h-[310px] items-center justify-center bg-[#1b1327]">
            <span className="text-[14px] font-medium text-[#a1a1aa]">Paused video</span>
          </div>

          <div className="flex h-[506px] flex-col gap-[14px] overflow-hidden rounded-t-[24px] bg-[#111115] p-4">
            <Drawer.Handle className="h-1 w-[42px] rounded-full bg-[#71717a] self-center" />
            <div className="flex items-start justify-between text-[#f7f7f8]">
              <p className="text-[17px] font-semibold">
                {loading && sortedComments.length === 0 ? 'Loading comments...' : `${sortedComments.length} comments`}
              </p>
              <Drawer.Close className="text-[22px] leading-none text-[#f7f7f8]">
                ×
              </Drawer.Close>
            </div>

            <div className="flex flex-1 flex-col gap-[14px] overflow-y-auto pr-1">
              {sortedComments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-[#71717a]">
                  <p className="text-[13px]">No comments yet.</p>
                  <p className="text-[11px]">Be the first to reply!</p>
                </div>
              ) : (
                sortedComments.map((comment) => (
                  <CommentRow key={comment.id} comment={comment} />
                ))
              )}
            </div>

            <form onSubmit={handleSubmit} className="flex h-[36px] items-center justify-between rounded-[20px] bg-[#18181d] px-3 py-2 mt-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={session ? 'Add a comment…' : 'Login to leave a comment'}
                disabled={!session}
                className="w-full bg-transparent text-[13px] text-[#a1a1aa] outline-none placeholder:text-[#a1a1aa] disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!session || !inputText.trim()}
                className="text-[13px] font-semibold text-[#8b5cf6] disabled:opacity-50"
              >
                Send
              </button>
            </form>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
