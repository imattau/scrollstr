import React, { useState, useMemo, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNostr } from '../../app/providers'
import { uploadMedia, calculateSha256 } from '../../nostr/blossom/upload'
import { publishVideoEvent } from '../../nostr/events'
import { db } from '../../nostr/cache'
import { useLiveQuery } from 'dexie-react-hooks'

const postSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string(),
  hashtags: z.string(),
  altText: z.string(),
})

type PostFormValues = z.infer<typeof postSchema>

const generateThumbnailFromVideo = (videoFile: File): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video')
    const blobUrl = URL.createObjectURL(videoFile)
    video.preload = 'metadata'
    video.src = blobUrl
    video.muted = true
    video.playsInline = true

    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      cleanup()
      reject(new Error('Thumbnail generation timed out after 10s'))
    }, 10000)

    const cleanup = () => {
      clearTimeout(timeout)
      video.pause()
      video.removeAttribute('src')
      try { video.load() } catch (_) {}
      URL.revokeObjectURL(blobUrl)
    }

    video.onloadedmetadata = () => {
      if (timedOut) return
      video.currentTime = 1
    }

    video.onseeked = () => {
      if (timedOut) return
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        cleanup()
        return reject(new Error('Canvas 2D context not available'))
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        cleanup()
        if (blob) resolve(blob)
        else reject(new Error('Canvas blob extraction failed'))
      }, 'image/jpeg', 0.85)
    }

    video.onerror = (err) => {
      cleanup()
      reject(err)
    }
  })

export const PostWizard: React.FC = () => {
  const { pool, signEvent, session } = useNostr()
  const userPubkey = session?.pubkey

  // Retrieve user's configured Blossom and NIP-96 lists from Dexie cache
  const blossomListEvents: any[] = useLiveQuery(
    async () => {
      if (!userPubkey) return []
      return db.cachedEvents.where({ kind: 10063, pubkey: userPubkey }).toArray()
    },
    [userPubkey]
  ) ?? []
  const blossomListEvent = blossomListEvents[blossomListEvents.length - 1]?.event

  const nip96ListEvents: any[] = useLiveQuery(
    async () => {
      if (!userPubkey) return []
      return db.cachedEvents.where({ kind: 10096, pubkey: userPubkey }).toArray()
    },
    [userPubkey]
  ) ?? []
  const nip96ListEvent = nip96ListEvents[nip96ListEvents.length - 1]?.event

  // Combine custom configured servers with priority order
  const uploadServers = useMemo(() => {
    const servers: string[] = []

    if (blossomListEvent) {
      const parsed = blossomListEvent.tags
        .filter((t: any) => t[0] === 'server' || t[0] === 'r')
        .map((t: any) => t[1])
      servers.push(...parsed)
    }

    if (nip96ListEvent) {
      const parsed = nip96ListEvent.tags
        .filter((t: any) => t[0] === 'server' || t[0] === 'r')
        .map((t: any) => t[1])
      servers.push(...parsed)
    }

    // Default fallbacks if no custom servers are configured
    if (servers.length === 0) {
      return [
        'https://cdn.nostr.build',
        'https://nostr.build',
        'https://void.cat',
        'https://blossom.damus.io',
      ]
    }

    return Array.from(new Set(servers))
  }, [blossomListEvent, nip96ListEvent])

  const { register, handleSubmit, watch, getValues, formState: { errors } } = useForm<PostFormValues>({
    resolver: zodResolver(postSchema),
    defaultValues: {
      title: 'Night walk in Melbourne',
      description: 'The city after rain.',
      hashtags: '#melbourne #nightwalk',
      altText: 'Wet city street reflecting lights at night',
    },
  })

  const watchedTitle = watch('title')
  const watchedDescription = watch('description')
  const watchedHashtags = watch('hashtags')
  const watchedAltText = watch('altText')

  const [step] = useState(2)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoPreview, setVideoPreview] = useState('')

  // Revoke blob URL on unmount or when preview changes
  useEffect(() => {
    return () => {
      if (videoPreview) {
        URL.revokeObjectURL(videoPreview)
      }
    }
  }, [videoPreview])
  const [uploadProgress, setUploadProgress] = useState(0)
  const [statusMessage, setStatusMessage] = useState('')
  const [error, setError] = useState('')

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
      
      setUploadProgress(20)
      setStatusMessage('Calculating video hash...')
      const videoHash = await calculateSha256(videoFile)

      let videoUploadResult = null
      let posterUrl = ''
      let uploadError = null

      for (const server of uploadServers) {
        try {
          if (thumbnailBlob) {
            setUploadProgress(40)
            setStatusMessage(`Uploading poster to ${server}...`)
            const posterRes = await uploadMedia(signEvent, thumbnailBlob, server)
            posterUrl = posterRes.url
          }

          setUploadProgress(70)
          setStatusMessage(`Uploading video to ${server}...`)
          videoUploadResult = await uploadMedia(signEvent, videoFile, server)

          uploadError = null
          break
        } catch (err: any) {
          console.warn(`Upload using server ${server} failed, trying next...`, err)
          uploadError = err
        }
      }

      if (!videoUploadResult) {
        throw new Error(uploadError?.message || 'All media servers failed to accept the upload')
      }

      setUploadProgress(90)
      setStatusMessage('Broadcasting video event...')
      const values = getValues()
      const tagsArray = values.hashtags
        .replaceAll('#', '')
        .split(/[\s,]+/)
        .map((t: string) => t.trim())
        .filter(Boolean)

      await publishVideoEvent(
        signEvent,
        videoUploadResult.url,
        videoHash,
        posterUrl,
        values.title || videoFile.name,
        `${values.description} ${values.altText}`.trim(),
        tagsArray
      )

      setUploadProgress(100)
      alert('Clip published!')
    } catch (err: any) {
      console.error('Publish pipeline failed:', err)
      setError(err.message || 'Publishing failed')
    } finally {
      setStatusMessage('')
      setUploadProgress(0)
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
          <input {...register('title')} className="bg-transparent text-[13px] text-[#f7f7f8] outline-none" />
          {errors.title && <p className="text-[11px] text-red-400 mt-1">{errors.title.message}</p>}
        </div>

        <div className="flex flex-col gap-[5px] rounded-[12px] bg-[#18181d] px-[14px] py-[10px]">
          <span className="text-[11px] font-medium text-[#a1a1aa]">Description</span>
          <input {...register('description')} className="bg-transparent text-[13px] text-[#f7f7f8] outline-none" />
        </div>

        <div className="flex flex-col gap-[5px] rounded-[12px] bg-[#18181d] px-[14px] py-[10px]">
          <span className="text-[11px] font-medium text-[#a1a1aa]">Hashtags</span>
          <input {...register('hashtags')} className="bg-transparent text-[13px] text-[#f7f7f8] outline-none" />
        </div>

        <div className="flex flex-col gap-[5px] rounded-[12px] bg-[#18181d] px-[14px] py-[10px]">
          <span className="text-[11px] font-medium text-[#a1a1aa]">Alt text</span>
          <input {...register('altText')} className="bg-transparent text-[13px] text-[#f7f7f8] outline-none" />
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
