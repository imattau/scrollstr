import React, { useState, useEffect } from 'react'
import { X, Send } from 'lucide-react'
import { useNostr } from '../../app/providers'
import { fetchComments, publishComment } from '../../nostr/events/comments'
import { NDKEvent } from '@nostr-dev-kit/ndk'

interface CommentsSheetProps {
  isOpen: boolean
  videoId: string
  creatorPubkey: string
  onClose: () => void
}

export const CommentsSheet: React.FC<CommentsSheetProps> = ({
  isOpen,
  videoId,
  creatorPubkey,
  onClose,
}) => {
  const { ndk, session } = useNostr()
  const [comments, setComments] = useState<NDKEvent[]>([])
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(false)

  // Load comments when video or sheet state changes
  useEffect(() => {
    if (!isOpen || !videoId) return

    setLoading(true)
    fetchComments(ndk, videoId)
      .then((fetched) => {
        // Sort comments by timestamp (ascending)
        const sorted = [...fetched].sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
        setComments(sorted)
      })
      .catch((err) => console.error('Failed to load comments:', err))
      .finally(() => setLoading(false))
  }, [ndk, videoId, isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputText.trim()) return

    if (!session) {
      alert('Please connect your Nostr account to comment')
      return
    }

    try {
      const newComment = await publishComment(ndk, videoId, creatorPubkey, inputText)
      setComments((prev) => [...prev, newComment])
      setInputText('')
    } catch (err) {
      console.error('Failed to post comment:', err)
      alert('Error posting comment: ' + err)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 bg-neutral-900 border-t border-neutral-800 rounded-t-3xl h-[70vh] flex flex-col animate-in slide-in-from-bottom duration-250">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-neutral-800 shrink-0">
        <div>
          <h3 className="font-bold text-sm text-neutral-100">Comments</h3>
          <span className="text-[10px] text-neutral-500 font-semibold">{comments.length} responses</span>
        </div>
        <button onClick={onClose} className="p-1 text-neutral-400 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Comment List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex justify-center items-center h-20 text-xs text-neutral-500">
            Loading comment thread...
          </div>
        ) : comments.length === 0 ? (
          <div className="flex justify-center items-center h-20 text-xs text-neutral-500">
            No comments yet. Be the first to reply!
          </div>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="flex gap-2 items-start text-xs">
              <img
                src={'https://api.dicebear.com/7.x/bottts/svg?seed=' + comment.pubkey}
                alt="user"
                className="w-7 h-7 rounded-full border border-neutral-800 bg-neutral-950 shrink-0"
              />
              <div className="bg-neutral-950 p-3 rounded-2xl flex-1 border border-neutral-850">
                <span className="font-bold text-[10px] text-purple-400 block mb-0.5">
                  @{comment.pubkey.slice(0, 8)}
                </span>
                <p className="text-neutral-200 leading-relaxed break-words">{comment.content}</p>
                <span className="text-[8px] text-neutral-500 mt-1 block">
                  {comment.created_at ? new Date(comment.created_at * 1000).toLocaleTimeString() : ''}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input Box */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-neutral-800 bg-neutral-950 shrink-0 flex gap-2 items-center">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={session ? "Add comment..." : "Login to leave a comment"}
          disabled={!session}
          className="flex-grow bg-neutral-900 border border-neutral-850 rounded-xl px-4 py-2.5 text-xs text-neutral-200 focus:outline-none focus:border-purple-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!session || !inputText.trim()}
          className="p-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl disabled:opacity-50 disabled:bg-neutral-800 transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  )
}
