import React, { useState } from 'react'
import { useNostr } from '../../app/providers'
import { uploadToBlossom, calculateSha256 } from '../../nostr/blossom/upload'
import { publishVideoEvent } from '../../nostr/events/video'

const generateThumbnailFromVideo = (videoFile: File): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.src = URL.createObjectURL(videoFile)
    video.muted = true
    video.playsInline = true

    video.onloadedmetadata = () => {
      video.currentTime = 1
    }

    video.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('Canvas 2D context not available'))
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Canvas blob extraction failed'))
      }, 'image/jpeg', 0.85)
    }

    video.onerror = (err) => reject(err)
  })

export const PostWizard: React.FC = () => {
  const { rxNostr, signEvent, session } = useNostr()
  const [step] = useState(2)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoPreview, setVideoPreview] = useState('')
  const [title, setTitle] = useState('Night walk in Melbourne')
  const [description, setDescription] = useState('The city after rain.')
  const [hashtags, setHashtags] = useState('#melbourne #nightwalk')
  const [altText, setAltText] = useState('Wet city street reflecting lights at night')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [statusMessage, setStatusMessage] = useState('')
  const [error, setError] = useState('')

  const DEFAULT_BLOSSOM_SERVER = 'https://blossom.damus.io'

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('video/')) {
      alert('Please select a valid video file')
      return
    }
    setVideoFile(file)
    setVideoPreview(URL.createObjectURL(file))
  }

  const handlePublish = async () => {
    if (!videoFile) return
    if (!session) {
      alert('Please connect your Nostr account to publish videos')
      return
    }

    setError('')
    setUploadProgress(10)
    setStatusMessage('Generating poster frame...')
    try {
      const thumbnailBlob = await generateThumbnailFromVideo(videoFile).catch(() => null)
      let posterUrl = ''
      if (thumbnailBlob) {
        setUploadProgress(30)
        setStatusMessage('Uploading poster to Blossom...')
        posterUrl = (await uploadToBlossom(signEvent, thumbnailBlob, DEFAULT_BLOSSOM_SERVER)).url
      }

      setUploadProgress(50)
      setStatusMessage('Calculating video hash...')
      const videoHash = await calculateSha256(videoFile)

      setUploadProgress(70)
      setStatusMessage('Uploading video to Blossom...')
      const videoUploadResult = await uploadToBlossom(signEvent, videoFile, DEFAULT_BLOSSOM_SERVER)

      setUploadProgress(90)
      setStatusMessage('Broadcasting video event...')
      const tagsArray = hashtags
        .replaceAll('#', '')
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter(Boolean)

      await publishVideoEvent(
        signEvent,
        rxNostr,
        videoUploadResult.url,
        videoHash,
        posterUrl,
        title || videoFile.name,
        `${description} ${altText}`.trim(),
        tagsArray
      )

      setUploadProgress(100)
      alert('Clip published!')
    } catch (err: any) {
      console.error('Publish pipeline failed:', err)
      setError(err.message || 'Publishing failed')
    }
  }

  return (
    <div className="flex min-h-full flex-col bg-[#09090b] text-[#f7f7f8]">
      <div className="flex h-[56px] items-center justify-between px-4">
        <h2 className="text-[18px] font-bold">Post video</h2>
        <button className="text-[22px] leading-none">×</button>
      </div>

      <div className="flex flex-1 flex-col gap-[17px] overflow-y-auto px-[18px] pb-[76px]">
        {error && <div className="rounded-[12px] border border-red-500/25 bg-red-500/10 p-3 text-[12px] text-red-300">{error}</div>}

        <div className="flex gap-[6px]">
          <span className="rounded-[18px] bg-[#18181d] px-[13px] py-[7px] text-[12px] font-medium">1 Select</span>
          <span className="rounded-[18px] bg-[#f7f7f8] px-[13px] py-[7px] text-[12px] font-semibold text-[#09090b]">2 Details</span>
          <span className="rounded-[18px] bg-[#18181d] px-[13px] py-[7px] text-[12px] font-medium">3 Publish</span>
        </div>

        <label className="flex h-[350px] w-full flex-col items-center justify-center rounded-[18px] bg-[#21172e]">
          {videoPreview ? (
            <video src={videoPreview} className="h-full w-full rounded-[18px] object-cover" controls />
          ) : (
            <>
              <span className="text-[14px] font-medium text-[#a1a1aa]">9:16 preview</span>
              <input type="file" accept="video/mp4,video/*" className="hidden" onChange={handleFileChange} />
            </>
          )}
        </label>

        <div className="flex flex-col gap-[5px] rounded-[12px] bg-[#18181d] px-[14px] py-[10px]">
          <span className="text-[11px] font-medium text-[#a1a1aa]">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="bg-transparent text-[13px] text-[#f7f7f8] outline-none" />
        </div>

        <div className="flex flex-col gap-[5px] rounded-[12px] bg-[#18181d] px-[14px] py-[10px]">
          <span className="text-[11px] font-medium text-[#a1a1aa]">Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="bg-transparent text-[13px] text-[#f7f7f8] outline-none" />
        </div>

        <div className="flex flex-col gap-[5px] rounded-[12px] bg-[#18181d] px-[14px] py-[10px]">
          <span className="text-[11px] font-medium text-[#a1a1aa]">Hashtags</span>
          <input value={hashtags} onChange={(e) => setHashtags(e.target.value)} className="bg-transparent text-[13px] text-[#f7f7f8] outline-none" />
        </div>

        <div className="flex flex-col gap-[5px] rounded-[12px] bg-[#18181d] px-[14px] py-[10px]">
          <span className="text-[11px] font-medium text-[#a1a1aa]">Alt text</span>
          <input value={altText} onChange={(e) => setAltText(e.target.value)} className="bg-transparent text-[13px] text-[#f7f7f8] outline-none" />
        </div>
      </div>

      <div className="flex h-[76px] items-center justify-between px-[18px]">
        <button
          type="button"
          className="rounded-[11px] bg-[#18181d] px-[16px] py-[11px] text-[13px] font-semibold text-white"
          onClick={() => window.history.back()}
        >
          Back
        </button>
        <button
          type="button"
          onClick={handlePublish}
          disabled={!session || !videoFile || !!statusMessage}
          className="rounded-[11px] bg-[#8b5cf6] px-[16px] py-[11px] text-[13px] font-semibold text-white disabled:opacity-50"
        >
          Upload and publish
        </button>
      </div>

      {statusMessage ? (
        <div className="px-[18px] pb-[18px] text-[11px] text-[#71717a]">
          {statusMessage} {uploadProgress ? `${uploadProgress}%` : ''}
        </div>
      ) : null}
    </div>
  )
}
