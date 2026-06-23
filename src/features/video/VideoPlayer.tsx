import React, { useRef, useEffect, useState } from 'react'
import { MediaController, MediaControlBar, MediaPlayButton, MediaMuteButton, MediaTimeRange } from 'media-chrome/react'
import Hls from 'hls.js'
import { updateMediaStatus } from '../../nostr/cache'

interface VideoPlayerProps {
  url: string
  poster?: string
  isActive: boolean
  isNearActive: boolean
  isMuted: boolean
  onLike?: () => void
  showControls?: boolean
}

const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_DURATION_SECONDS = 300;

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ url, poster, isActive, isNearActive, isMuted, onLike, showControls = false }) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsInstanceRef = useRef<Hls | null>(null)
  const [isHls, setIsHls] = useState(false)
  const [wasPlayingBeforePress, setWasPlayingBeforePress] = useState(false)

  const [isPaused, setIsPaused] = useState(true)

  // Detect if source is HLS (.m3u8)
  useEffect(() => {
    if (url.includes('.m3u8') || url.includes('/hls/')) {
      setIsHls(true)
    } else {
      setIsHls(false)
    }
  }, [url])

  // Playback control based on active status in feed
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (isActive && isNearActive) {
      // In active viewport
      video.play().catch((err) => {
        console.log('Autoplay blocked or interrupted:', err)
      })
    } else {
      // Out of active viewport
      video.pause()
      video.currentTime = 0 // Reset to beginning
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

    // Media Guard Check: Head request to evaluate content length
    let isAborted = false
    const abortController = new AbortController()
    
    fetch(url, { method: 'HEAD', signal: abortController.signal })
      .then(async (res) => {
        if (isAborted) return
        const contentLength = res.headers.get('content-length')
        if (contentLength) {
          const bytes = parseInt(contentLength, 10)
          if (bytes > MAX_VIDEO_BYTES) {
            console.warn(`Video too large: ${(bytes / 1024 / 1024).toFixed(1)}MB. Skipping.`)
            await updateMediaStatus(url, 'too_large', { size: bytes })
            return
          }
        }
        
        // Proceed with loading
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
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        console.error('Failed to probe media metadata:', err)
        // Fallback load even if HEAD fails (e.g. CORS block on HEAD)
        if (isHls) {
          if (Hls.isSupported()) {
            const hls = new Hls({ maxMaxBufferLength: 10 })
            hls.loadSource(url)
            hls.attachMedia(video)
            hlsInstanceRef.current = hls
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url
          }
        } else {
          video.src = url
        }
      })

    // Listen to metadata load to enforce duration limits
    const handleLoadedMetadata = async () => {
      if (video.duration > MAX_DURATION_SECONDS) {
        console.warn(`Video duration exceeds limit: ${video.duration}s. Pausing.`)
        video.pause()
        video.removeAttribute('src')
        try {
          video.load()
        } catch (_) {}
        await updateMediaStatus(url, 'too_large', { duration: video.duration })
      } else {
        await updateMediaStatus(url, 'available', { duration: video.duration })
      }
    }

    const handleLoadError = async () => {
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
  const handlePressStart = () => {
    const video = videoRef.current
    if (!video || video.paused) {
      setWasPlayingBeforePress(false)
      return
    }
    setWasPlayingBeforePress(true)
    // Temporarily pause
    video.pause()
  }

  const handlePressEnd = () => {
    const video = videoRef.current
    if (!video) return
    if (wasPlayingBeforePress) {
      video.play().catch(console.error)
    }
  }

  return (
    <div className="relative w-full h-full bg-black select-none overflow-hidden">
      <MediaController className="w-full h-full">
        <video
          ref={videoRef}
          slot="media"
          className="w-full h-full object-cover"
          poster={poster}
          preload={isActive ? 'auto' : 'metadata'}
          loop
          muted={isMuted} // Start muted for autoplay browser policies, sync with isMuted
          playsInline
          onClick={handleSingleClick}
          onDoubleClick={handleDoubleClick}
          onMouseDown={handlePressStart}
          onMouseUp={handlePressEnd}
          onMouseLeave={handlePressEnd}
          onTouchStart={handlePressStart}
          onTouchEnd={handlePressEnd}
        />
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
