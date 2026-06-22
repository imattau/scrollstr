import React, { useRef, useEffect, useState } from 'react'
import { MediaController, MediaControlBar, MediaPlayButton, MediaMuteButton, MediaTimeRange } from 'media-chrome/react'
import Hls from 'hls.js'

interface VideoPlayerProps {
  url: string
  poster?: string
  isActive: boolean
  onLike?: () => void
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ url, poster, isActive, onLike }) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isHls, setIsHls] = useState(false)
  const [hlsInstance, setHlsInstance] = useState<Hls | null>(null)
  const [wasPlayingBeforePress, setWasPlayingBeforePress] = useState(false)

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

    if (isActive) {
      // In active viewport
      video.play().catch((err) => {
        console.log('Autoplay blocked or interrupted:', err)
      })
    } else {
      // Out of active viewport
      video.pause()
      video.currentTime = 0 // Reset to beginning
    }
  }, [isActive])

  // Set up HLS or native playback
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // Clean up previous HLS instance
    if (hlsInstance) {
      hlsInstance.destroy()
      setHlsInstance(null)
    }

    if (isHls) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          maxMaxBufferLength: 10, // Optimize memory for vertical feed
        })
        hls.loadSource(url)
        hls.attachMedia(video)
        setHlsInstance(hls)
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native safari HLS support
        video.src = url
      }
    } else {
      video.src = url
    }

    return () => {
      if (hlsInstance) {
        hlsInstance.destroy()
      }
    }
  }, [url, isHls])

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
          muted // Start muted for autoplay browser policies
          playsInline
          onClick={handleSingleClick}
          onDoubleClick={handleDoubleClick}
          onMouseDown={handlePressStart}
          onMouseUp={handlePressEnd}
          onMouseLeave={handlePressEnd}
          onTouchStart={handlePressStart}
          onTouchEnd={handlePressEnd}
        />

        {/* Media Chrome Custom Controls Overlay */}
        <MediaControlBar className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 flex gap-4 items-center">
          <MediaPlayButton className="text-white hover:text-purple-400 bg-transparent border-0" />
          <MediaMuteButton className="text-white hover:text-purple-400 bg-transparent border-0" />
          <MediaTimeRange className="flex-1 accent-purple-600 bg-transparent" />
        </MediaControlBar>
      </MediaController>
    </div>
  )
}
