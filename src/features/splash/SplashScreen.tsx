import React, { useState, useEffect, useRef } from 'react'

interface SplashScreenProps {
  onFinish: () => void
}

const STAGES = [
  'Syncing your profile…',
  'Connecting to relays…',
  'Fetching videos…',
  'Getting ready…',
]

const STAGE_TIMINGS = [0, 2500, 5000, 7500]

export const SplashScreen: React.FC<SplashScreenProps> = ({ onFinish }) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [stageIndex, setStageIndex] = useState(0)
  const [isExiting, setIsExiting] = useState(false)
  const finishedRef = useRef(false)

  useEffect(() => {
    const timers = STAGE_TIMINGS.map((t, i) =>
      setTimeout(() => setStageIndex(i), t)
    )
    return () => timers.forEach(clearTimeout)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!finishedRef.current) {
        finishedRef.current = true
        setIsExiting(true)
        setTimeout(onFinish, 500)
      }
    }, 15000)
    return () => clearTimeout(timer)
  }, [onFinish])

  const handleEnded = () => {
    if (finishedRef.current) return
    finishedRef.current = true
    setIsExiting(true)
    setTimeout(onFinish, 500)
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-black transition-opacity duration-500 ease-in-out ${
        isExiting ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-contain"
        src="/videos/The_Neon_Mascot_A_short_loop.mp4"
        muted
        playsInline
        autoPlay
        onEnded={handleEnded}
      />

      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/70" />

      <div className="relative z-10 flex flex-col items-center gap-6 px-6">
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Nostr Clips
        </h1>

        <p className="text-sm text-neutral-400 transition-all duration-300">
          {STAGES[stageIndex]}
        </p>

        <div className="h-1 w-48 overflow-hidden rounded-full bg-neutral-800">
          <div
            className="h-full rounded-full bg-purple-500 transition-all duration-[800ms] ease-linear"
            style={{ width: `${((stageIndex + 1) / STAGES.length) * 100}%` }}
          />
        </div>
      </div>
    </div>
  )
}
