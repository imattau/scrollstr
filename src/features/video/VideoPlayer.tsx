import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  MediaPlayer,
  MediaProvider,
  Gesture,
  Controls,
  TimeSlider,
  isHLSProvider,
} from '@vidstack/react'
import type { MediaProviderSetupEvent } from '@vidstack/react'
import { RotateCw } from 'lucide-react'
import { updateMediaStatus } from '../../nostr/cache'
import { isInternalUrl, isSafeVideoUrl } from '../../lib/crypto'
import { markVideoLoadStart, markVideoLoaded, markPlaybackEvent } from '../../lib/performance'
import '@vidstack/react/player/styles/default/theme.css'
import Hls from 'hls.js'

const probedUrls = new Set<string>()
const MAX_PROBED_URLS = 500

interface VideoPlayerProps {
  url: string
  poster?: string
  isActive: boolean
  isNearActive: boolean
  isMuted: boolean
  onLike?: () => void
  showControls?: boolean
  autoScroll?: boolean
  onVideoEnded?: () => void
}

export const VideoPlayer = React.memo<VideoPlayerProps>(({
  url, poster, isActive, isNearActive, isMuted,
  onLike, showControls = false, autoScroll, onVideoEnded,
}) => {
  const playerRef = useRef<any>(null)
  const [displayUrl, setDisplayUrl] = useState(isNearActive ? url : '')
  const unloadTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [isLandscape, setIsLandscape] = useState(false)
  const [paused, setPaused] = useState(true)
  const [waiting, setWaiting] = useState(true)

  // Play/pause based on feed active state (debounced pause on inactive)
  useEffect(() => {
    const player = playerRef.current
    if (!player) return

    if (isActive && isNearActive) {
      player.play().catch((err: any) => {
        if (err.name !== 'AbortError') console.log('Autoplay blocked:', err)
      })
    } else {
      const timer = setTimeout(() => {
        player.pause()
        player.currentTime = 0
      }, 400)
      return () => clearTimeout(timer)
    }
  }, [isActive, isNearActive])

  // Grace period for scroll-back (keep source alive 10s after leaving viewport)
  useEffect(() => {
    if (isNearActive) {
      if (unloadTimerRef.current !== undefined) clearTimeout(unloadTimerRef.current)
      setDisplayUrl(url)
    } else {
      unloadTimerRef.current = setTimeout(() => setDisplayUrl(''), 10000)
    }
    return () => {
      if (unloadTimerRef.current !== undefined) clearTimeout(unloadTimerRef.current)
    }
  }, [isNearActive, url])

  // HEAD probing for media status (fire-and-forget, no effect on source loading)
  const headProbedRef = useRef(false)
  useEffect(() => {
    if (!isNearActive || !displayUrl || !isSafeVideoUrl(displayUrl) || isInternalUrl(displayUrl) || headProbedRef.current) return
    headProbedRef.current = true
    const controller = new AbortController()
    fetch(displayUrl, { method: 'HEAD', signal: controller.signal })
      .then(async res => {
        const contentLength = res.headers.get('content-length')
        if (contentLength) {
          await updateMediaStatus(displayUrl, 'available', { size: parseInt(contentLength, 10) })
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [isNearActive, displayUrl])

  useEffect(() => { headProbedRef.current = false }, [url])

  // Configure HLS provider with our local hls.js
  const onProviderSetup = useCallback((detail: any, _event: MediaProviderSetupEvent) => {
    if (isHLSProvider(detail)) {
      detail.library = Hls as any
      detail.config = { maxMaxBufferLength: 10 }
    }
  }, [])

  return (
    <div className="relative w-full h-full bg-black select-none overflow-hidden">
      {displayUrl ? (
        <MediaPlayer
          ref={playerRef}
          className="[aspect-ratio:unset]"
          src={displayUrl}
          poster={poster}
          muted={isMuted}
          loop={!autoScroll}
          playsInline
          onEnded={onVideoEnded}
          onProviderSetup={onProviderSetup}
          onPlay={() => { setPaused(false); markPlaybackEvent(url, 'play') }}
          onPause={() => { setPaused(true); markPlaybackEvent(url, 'pause') }}
          onWaiting={() => { setWaiting(true); markPlaybackEvent(url, 'rebuffer') }}
          onPlaying={() => { setWaiting(false); markPlaybackEvent(url, 'resume') }}
          onLoadStart={() => markVideoLoadStart(url)}
          onCanPlay={() => markVideoLoaded(url)}
          onLoadedMetadata={(e: any) => {
            const el = e.target as HTMLVideoElement | null
            if (el?.videoWidth) setIsLandscape(el.videoWidth > el.videoHeight)
          }}
        >
          <MediaProvider mediaProps={{ className: 'w-full h-full object-cover' }} />

          <Gesture event="pointerup" action="toggle:paused" />
          <Gesture event="dblpointerup" onTrigger={() => onLike?.()} />

          {waiting && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/30">
              <div className="size-9 animate-spin rounded-full border-2 border-[#27272a] border-t-[#8b5cf6]" />
            </div>
          )}

          {paused && (
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
            <Controls.Root className="absolute bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-black/80 to-transparent p-4">
              <Controls.Group className="flex items-center gap-4">
                <TimeSlider.Root className="flex-1" />
              </Controls.Group>
            </Controls.Root>
          )}

          {isNearActive && (
            <div className="absolute bottom-0 left-0 right-0 z-40 px-2 pb-1">
              <TimeSlider.Root className="w-full h-1" />
            </div>
          )}
        </MediaPlayer>
      ) : (
        <div className="w-full h-full bg-black" />
      )}
    </div>
  )
})
