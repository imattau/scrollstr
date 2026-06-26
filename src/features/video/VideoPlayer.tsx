import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useGesture } from '@use-gesture/react'
import { MediaController, MediaControlBar, MediaPlayButton, MediaMuteButton, MediaTimeRange } from 'media-chrome/react'
import Hls from 'hls.js'
import { RotateCw } from 'lucide-react'
import { updateMediaStatus } from '../../nostr/cache'
import { isInternalUrl, isSafeVideoUrl } from '../../lib/crypto'

interface VideoPlayerProps {
  url: string
  poster?: string
  isActive: boolean
  isNearActive: boolean
  isMuted: boolean
  onLike?: () => void
  showControls?: boolean
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ url, poster, isActive, isNearActive, isMuted, onLike, showControls = false }) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsInstanceRef = useRef<Hls | null>(null)
  const [isHls, setIsHls] = useState(false)
  const [wasPlayingBeforePress, setWasPlayingBeforePress] = useState(false)
  const [isLandscape, setIsLandscape] = useState(false)
  const [isHovering, setIsHovering] = useState(false)
  const [isPaused, setIsPaused] = useState(true)
  const [isSourceLoading, setIsSourceLoading] = useState(true)

  // Detect if source is HLS (.m3u8)
  useEffect(() => {
    if (url.includes('.m3u8') || url.includes('/hls/')) {
      setIsHls(true)
    } else {
      setIsHls(false)
    }
  }, [url])

  // Playback control based on active status in feed
  // Debounced to avoid stutter during brief isActive flickers from feed reorder.
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (isActive && isNearActive) {
      if (pauseTimerRef.current) {
        clearTimeout(pauseTimerRef.current)
        pauseTimerRef.current = null
      }
      video.play().catch((err) => {
        console.log('Autoplay blocked or interrupted:', err)
      })
    } else {
      pauseTimerRef.current = setTimeout(() => {
        pauseTimerRef.current = null
        video.pause()
        if (video.src) video.currentTime = 0
      }, 400)
    }

    return () => {
      if (pauseTimerRef.current) {
        clearTimeout(pauseTimerRef.current)
        pauseTimerRef.current = null
      }
    }
  }, [isActive, isNearActive])

  // Sync mute state dynamically
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted
    }
  }, [isMuted])

  // Set up HLS or native playback only when near active viewport
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // Clean up previous HLS instance
    if (hlsInstanceRef.current) {
      hlsInstanceRef.current.destroy()
      hlsInstanceRef.current = null
    }

    if (!isNearActive) {
      // Fully strip media resource to release browser decoding memory
      video.pause()
      video.removeAttribute('src')
      try {
        video.load()
      } catch (_) {}
      return
    }

    // Validate URL before probing to prevent SSRF
    if (!isSafeVideoUrl(url)) {
      console.warn(`[VideoPlayer] Skipping unsafe video URL: ${url}`)
      setIsSourceLoading(false)
      return
    }

    // Fire-and-forget HEAD probe to update media status; don't block source loading
    let isAborted = false
    const abortController = new AbortController()
    
    // Skip HEAD probe for internal URLs (SSRF protection); still allow playback
    if (!isInternalUrl(url)) {
      fetch(url, { method: 'HEAD', signal: abortController.signal })
        .then(async (res) => {
          if (isAborted) return
          const contentLength = res.headers.get('content-length')
          if (contentLength) {
            await updateMediaStatus(url, 'available', { size: parseInt(contentLength, 10) })
          }
        })
        .catch((err) => {
          if (err.name !== 'AbortError') {
            console.warn('Failed to probe media metadata:', err)
          }
        })
    }

    setIsSourceLoading(true)

    // Load source immediately, in parallel with the HEAD request
    if (isHls) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          maxMaxBufferLength: 10, // Optimize memory for vertical feed
        })
        hls.loadSource(url)
        hls.attachMedia(video)
        hlsInstanceRef.current = hls
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url
      }
    } else {
      video.src = url
    }

    // Listen to metadata load
    const handleLoadedMetadata = async () => {
      setIsSourceLoading(false)
      setIsLandscape(video.videoWidth > video.videoHeight)
      await updateMediaStatus(url, 'available', { duration: video.duration })
    }

    const handleLoadError = async () => {
      setIsSourceLoading(false)
      console.warn(`Failed to load video source: ${url}`)
      await updateMediaStatus(url, 'failed')
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('error', handleLoadError)

    return () => {
      isAborted = true
      abortController.abort()
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('error', handleLoadError)
      if (hlsInstanceRef.current) {
        hlsInstanceRef.current.destroy()
        hlsInstanceRef.current = null
      }
      video.pause()
      video.removeAttribute('src')
      try {
        video.load()
      } catch (_) {}
    }
  }, [url, isHls, isNearActive])

  // Track actual play/pause events
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handlePlay = () => setIsPaused(false)
    const handlePause = () => setIsPaused(true)

    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)

    // Set initial state
    setIsPaused(video.paused)

    return () => {
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
    }
  }, [isActive])

  // Gestures: Single Tap (Play/Pause), Double Tap (Like), Press and Hold (Pause)
  const handleSingleClick = (e: React.MouseEvent) => {
    // Avoid triggering when clicking on control buttons (which bubbles up)
    const target = e.target as HTMLElement
    if (target.closest('media-control-bar') || target.closest('button')) {
      return
    }

    const video = videoRef.current
    if (!video) return

    if (video.paused) {
      video.play().catch(console.error)
    } else {
      video.pause()
    }
  }

  // Double click for liking
  const handleDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('media-control-bar') || target.closest('button')) {
      return
    }
    if (onLike) {
      onLike()
    }
  }

  // Press and Hold: Temporary Pause
  const handlePressStart = useCallback(() => {
    const video = videoRef.current
    if (!video || video.paused) {
      setWasPlayingBeforePress(false)
      return
    }
    setWasPlayingBeforePress(true)
    video.pause()
  }, [])

  const handlePressEnd = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (wasPlayingBeforePress) {
      video.play().catch(console.error)
    }
  }, [wasPlayingBeforePress])

  // @use-gesture/react: horizontal swipe to seek + hover tracking
  const bindGestures = useGesture({
    onDrag: ({ down, movement: [mx], event }) => {
      if (!down) return
      const video = videoRef.current
      if (!video || !video.duration) return

      if (event.target && (event.target as HTMLElement).closest('media-control-bar')) return

      const containerWidth = window.innerWidth || 1
      const seekFraction = mx / containerWidth
      if (Math.abs(seekFraction) > 0.02) {
        video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seekFraction * video.duration))
      }
    },
    onHover: ({ hovering }) => {
      setIsHovering(hovering ?? false)
    },
  })

  return (
    <div {...bindGestures()} className="relative w-full h-full bg-black select-none overflow-hidden">
      <MediaController className="w-full h-full">
        <video
          ref={videoRef}
          slot="media"
          className={`w-full h-full ${isLandscape ? 'object-contain' : 'object-cover'}`}
          poster={poster}
          preload={isActive ? 'auto' : 'metadata'}
          loop
          muted={isMuted} // Start muted for autoplay browser policies, sync with isMuted
          playsInline
          onClick={handleSingleClick}
          onDoubleClick={handleDoubleClick}
          onPointerDown={handlePressStart}
          onPointerUp={handlePressEnd}
          onPointerLeave={handlePressEnd}
        />
        {isSourceLoading && isNearActive && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/30">
            <div className="size-9 animate-spin rounded-full border-2 border-[#27272a] border-t-[#8b5cf6]" />
          </div>
        )}
        {isPaused && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
            <div
              className="flex size-[62px] items-center justify-center rounded-full bg-[#18181d]/80 text-[19px] text-[#f7f7f8] shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-sm"
              aria-hidden="true"
            >
              <span className="ml-[3px]">▶</span>
            </div>
          </div>
        )}
        {isLandscape && (
          <div className="pointer-events-none absolute top-3 left-3 z-20 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-[#a1a1aa] backdrop-blur-sm">
            <RotateCw className="size-3" />
            <span>Rotate for full view</span>
          </div>
        )}
        {showControls && (
          <MediaControlBar className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 flex gap-4 items-center">
            <MediaPlayButton className="text-white hover:text-purple-400 bg-transparent border-0" />
            <MediaMuteButton className="text-white hover:text-purple-400 bg-transparent border-0" />
            <MediaTimeRange className="flex-1 accent-purple-600 bg-transparent" />
          </MediaControlBar>
        )}
      </MediaController>
    </div>
  )
}
