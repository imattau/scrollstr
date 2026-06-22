import React, { useEffect, useState, useMemo } from 'react'
import { useNostr } from '../../app/providers'
import { publishComment } from '../../nostr/events/comments'
import { createRxForwardReq } from 'rx-nostr'
import { getEventsQuery$ } from '../../nostr/rxNostr'
import { use$ } from 'applesauce-react/hooks'
import { useProfile } from '../../nostr/profile'

const CommentRow: React.FC<{ comment: any }> = ({ comment }) => {
  const profile = useProfile(comment.pubkey)
  const avatarInitial = profile.displayName?.slice(0, 1).toUpperCase() || 'N'

  return (
    <div className="flex items-start gap-[10px] py-3 border-b border-[#23232a]/30">
      <div
        className="flex size-[36px] overflow-hidden shrink-0 items-center justify-center rounded-full bg-[#8b5cf6] text-[12px] font-bold text-white"
      >
        {profile.picture ? (
          <img src={profile.picture} alt={profile.name} className="h-full w-full object-cover" />
        ) : (
          avatarInitial
        )}
      </div>
      <div className="flex flex-col gap-1 flex-1">
        <p className="text-[12px] font-semibold text-[#f7f7f8]">@{profile.displayName || profile.name}</p>
        <p className="text-[13px] font-normal leading-relaxed text-[#a1a1aa] break-words">{comment.content}</p>
        <p className="text-[10px] text-[#71717a]">
          {new Date(comment.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  )
}

export const DesktopCommentsPanel: React.FC<{ video: any }> = ({ video }) => {
  const { rxNostr, eventStore, session, signEvent } = useNostr()
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(false)

  // Query events in EventStore for kind:1111 referencing this video id
  const rawComments = use$(() => getEventsQuery$({
    kinds: [1111],
    '#e': [video?.id || '']
  }), [video?.id]) || []

  // Subscribe to real-time comments on relays
  useEffect(() => {
    if (!video?.id) return

    setLoading(true)
    console.log(`Subscribing to desktop comments for video ${video.id}...`)
    const rxReq = createRxForwardReq()
    const sub = rxNostr.use(rxReq).subscribe(() => {
      setLoading(false)
    })
    rxReq.emit({ kinds: [1111], '#e': [video.id] })

    // Hide loader after a brief timeout if no events are returned
    const timer = setTimeout(() => setLoading(false), 2000)

    return () => {
      sub.unsubscribe()
      clearTimeout(timer)
    }
  }, [rxNostr, video?.id])

  // Sort comments chronologically
  const sortedComments = useMemo(() => {
    return [...rawComments].sort((a, b) => a.created_at - b.created_at)
  }, [rawComments])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputText.trim() || !video) return
    if (!session) {
      alert('Please connect your Nostr account to comment')
      return
    }

    try {
      const newComment = await publishComment(signEvent, rxNostr, video.id, video.creator.pubkey, inputText)
      eventStore.add(newComment)
      setInputText('')
    } catch (err) {
      console.error('Failed to post comment:', err)
      alert('Error posting comment: ' + err)
    }
  }

  if (!video) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-500 text-center">
        <span className="text-sm">Select a video to see comments and creator details</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#111115] text-[#f7f7f8]">
      <div className="pb-4 border-b border-[#23232a]">
        <h3 className="text-[20px] font-bold">Comments</h3>
        <p className="text-[12px] text-[#a1a1aa] mt-1">
          {loading && sortedComments.length === 0 ? 'Loading comments...' : `${sortedComments.length} comments`}
        </p>
      </div>

      {/* Scrollable list of comments */}
      <div className="flex-1 overflow-y-auto py-4 space-y-2 pr-1">
        {sortedComments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[#71717a] text-center">
            <p className="text-[13px]">No comments yet.</p>
            <p className="text-[11px] mt-1">Be the first to reply!</p>
          </div>
        ) : (
          sortedComments.map((comment) => (
            <CommentRow key={comment.id} comment={comment} />
          ))
        )}
      </div>

      {/* Post comment input box */}
      <form onSubmit={handleSubmit} className="pt-4 border-t border-[#23232a] flex items-center gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={session ? 'Add a comment…' : 'Login to comment'}
          disabled={!session}
          className="flex-1 bg-[#18181d] px-3.5 py-2.5 rounded-xl text-[13px] text-[#f7f7f8] outline-none placeholder:text-[#a1a1aa] disabled:opacity-50 border border-transparent focus:border-[#8b5cf6]"
        />
        <button
          type="submit"
          disabled={!session || !inputText.trim()}
          className="bg-[#8b5cf6] text-white hover:bg-[#7c3aed] px-4 py-2.5 rounded-xl text-[13px] font-bold disabled:opacity-50 transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  )
}
