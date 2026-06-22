import React, { useState } from 'react'
import { Upload, Film, CheckCircle2, ChevronRight } from 'lucide-react'
import { useNostr } from '../../app/providers'
import { uploadToBlossom, calculateSha256 } from '../../nostr/blossom/upload'
import { publishVideoEvent } from '../../nostr/events/video'

// Utility to generate a thumbnail jpeg from a video file at 1s timestamp
const generateThumbnailFromVideo = (videoFile: File): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.src = URL.createObjectURL(videoFile)
    video.muted = true
    video.playsInline = true
    
    video.onloadedmetadata = () => {
      video.currentTime = 1 // grab frame at 1 second
    }

    video.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('Canvas blob extraction failed'))
          }
        }, 'image/jpeg', 0.85)
      } else {
        reject(new Error('Canvas 2D context not available'))
      }
    }

    video.onerror = (err) => reject(err)
  })
}

export const PostWizard: React.FC = () => {
  const { ndk, session } = useNostr()
  const [step, setStep] = useState(1)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoPreview, setVideoPreview] = useState<string>('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [hashtags, setHashtags] = useState('')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [statusMessage, setStatusMessage] = useState('')
  const [error, setError] = useState('')

  // Default Blossom upload host
  const DEFAULT_BLOSSOM_SERVER = 'https://blossom.damus.io'

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      if (!file.type.startsWith('video/')) {
        alert('Please select a valid video file')
        return
      }
      setVideoFile(file)
      setVideoPreview(URL.createObjectURL(file))
      setStep(2)
    }
  }

  const handlePublish = async () => {
    if (!videoFile) return
    if (!session) {
      alert('Please connect your Nostr account to publish videos')
      return
    }

    setError('')
    setStep(3)
    setUploadProgress(10)
    setStatusMessage('Generating poster frame...')

    try {
      // 1. Generate poster frame
      const thumbnailBlob = await generateThumbnailFromVideo(videoFile).catch((err) => {
        console.warn('Poster frame generation failed, continuing with placeholder poster', err)
        return null
      })
      
      setUploadProgress(30)
      setStatusMessage('Uploading poster to Blossom...')

      let posterUrl = ''
      if (thumbnailBlob) {
        const uploadResult = await uploadToBlossom(ndk, thumbnailBlob, DEFAULT_BLOSSOM_SERVER)
        posterUrl = uploadResult.url
      }

      setUploadProgress(50)
      setStatusMessage('Calculating video hash...')
      const videoHash = await calculateSha256(videoFile)

      setUploadProgress(70)
      setStatusMessage('Uploading video to Blossom (this may take a moment)...')
      const videoUploadResult = await uploadToBlossom(ndk, videoFile, DEFAULT_BLOSSOM_SERVER)

      setUploadProgress(90)
      setStatusMessage('Broadcasting video event to relays...')

      // Split hashtags comma-separated
      const tagsArray = hashtags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0)

      await publishVideoEvent(
        ndk,
        videoUploadResult.url,
        videoHash,
        posterUrl,
        title || videoFile.name,
        description,
        tagsArray
      )

      setUploadProgress(100)
      setStep(4)
    } catch (err: any) {
      console.error('Publish pipeline failed:', err)
      setError(err.message || 'Publishing failed')
      setStep(2) // return to form editing
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-neutral-900">
        <h2 className="text-xl font-bold">Publish Clip</h2>
        <span className="text-xs text-neutral-400 font-semibold">Step {step} of 4</span>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/25 text-red-400 text-xs rounded-xl">
          {error}
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col items-center justify-center border-2 border-dashed border-neutral-800 rounded-3xl p-10 bg-neutral-900/10 hover:bg-neutral-900/30 hover:border-purple-500/50 transition-all duration-300">
          <Upload className="w-12 h-12 text-neutral-600 mb-4 animate-bounce" />
          <h3 className="font-bold text-neutral-200">Select Video Clip</h3>
          <p className="text-xs text-neutral-500 text-center mt-2 max-w-[240px]">
            H.264 MP4 recommended. Local transcoding or recording is not supported.
          </p>
          <label className="mt-6 px-6 py-2.5 bg-purple-600 hover:bg-purple-700 font-semibold rounded-xl text-xs text-white cursor-pointer transition-colors shadow-lg shadow-purple-600/20">
            Choose File
            <input type="file" accept="video/mp4,video/x-m4v,video/*" className="hidden" onChange={handleFileChange} />
          </label>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {/* Video Preview */}
          <div className="aspect-[9/16] max-h-[300px] w-full rounded-2xl overflow-hidden bg-black border border-neutral-800">
            <video src={videoPreview} controls className="w-full h-full object-cover" />
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter a catchy title..."
                className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a detailed description..."
                className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-purple-500 h-20 resize-none"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">Hashtags</label>
              <input
                type="text"
                value={hashtags}
                onChange={(e) => setHashtags(e.target.value)}
                placeholder="nostr, video, music (comma separated)"
                className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          <button
            onClick={handlePublish}
            disabled={!session}
            className="w-full flex items-center justify-center gap-2 py-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-xl text-xs transition-all shadow-lg shadow-purple-600/25 disabled:opacity-50"
          >
            <span>{session ? 'Publish to Blossom & Relays' : 'Connect Account to Publish'}</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col items-center justify-center py-10 space-y-6">
          <Film className="w-12 h-12 text-purple-500 animate-spin" />
          <div className="text-center">
            <h3 className="font-bold text-neutral-200">Publishing Clip</h3>
            <p className="text-xs text-neutral-500 mt-1">{statusMessage}</p>
          </div>
          <div className="w-full max-w-[200px] h-1.5 bg-neutral-800 rounded-full overflow-hidden">
            <div className="h-full bg-purple-500 transition-all duration-200" style={{ width: `${uploadProgress}%` }}></div>
          </div>
          <span className="text-[10px] font-bold text-neutral-400">{uploadProgress}%</span>
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col items-center justify-center py-10 space-y-6 text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 animate-bounce" />
          <div>
            <h3 className="text-lg font-bold text-neutral-200">Clip Published!</h3>
            <p className="text-xs text-neutral-500 mt-1">Your video is now live on Nostr (kind:22)</p>
          </div>
          <button
            onClick={() => {
              setVideoFile(null)
              setVideoPreview('')
              setTitle('')
              setDescription('')
              setHashtags('')
              setUploadProgress(0)
              setStep(1)
            }}
            className="px-6 py-2.5 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-xs font-semibold transition-colors"
          >
            Upload Another
          </button>
        </div>
      )}
    </div>
  )
}
