import React, { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNostr } from '../../app/providers'
import { useToast } from '../../components/feedback/Toast'
import { uploadMedia, calculateSha256 } from '../../nostr/blossom/upload'
import { publishVideoEvent } from '../../nostr/events'
import { db } from '../../nostr/cache'
import { useLiveQuery } from 'dexie-react-hooks'
import { isSupportedVideo, convertToWebM } from './convertVideo'

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
  const { toast } = useToast()
  const navigate = useNavigate()
  const userPubkey = session?.pubkey

  // Retrieve user's configured Blossom and NIP-96 lists from Dexie cache
  const blossomListEvents: any[] = useLiveQuery(
    async () => {
      if (!userPubkey) return []
      return db.cachedEvents.where({ kind: 10063, pubkey: userPubkey }).toArray()
    },
    [userPubkey]
  ) ?? []
  const blossomListEvent = blossomListEvents.toSorted((a, b) => b.created_at - a.created_at)[0]?.event

  const nip96ListEvents: any[] = useLiveQuery(
    async () => {
      if (!userPubkey) return []
      return db.cachedEvents.where({ kind: 10096, pubkey: userPubkey }).toArray()
    },
    [userPubkey]
  ) ?? []
  const nip96ListEvent = nip96ListEvents.toSorted((a, b) => b.created_at - a.created_at)[0]?.event

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

  const { register, handleSubmit, getValues, formState: { errors } } = useForm<PostFormValues>({
    resolver: zodResolver(postSchema),
    defaultValues: {
      title: '',
      description: '',
      hashtags: '',
      altText: '',
    },
  })
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
  const [selectedResolution, setSelectedResolution] = useState<number>(720)
  const [conversionProgress, setConversionProgress] = useState(0)
  const [isConverting, setIsConverting] = useState(false)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!isSupportedVideo(file)) {
      toast('Unsupported format. Use MP4, WebM, MOV, AVI, MKV, or OGG.', 'error')
      return
    }
    setVideoFile(file)
    setVideoPreview(URL.createObjectURL(file))
    setSelectedResolution(720)
    setConversionProgress(0)
    setIsConverting(false)
  }

  const handlePublish = async () => {
    if (!videoFile) return
    if (!session) {
      toast('Please connect your Nostr account to publish videos', 'info')
      return
    }

    setError('')
    setUploadProgress(10)

    let uploadFile = videoFile
    let mimeType = videoFile.type

    if (videoFile.type !== 'video/webm') {
      setIsConverting(true)
      setConversionProgress(0)
      setStatusMessage('Converting to WebM...')

      try {
        const webmBlob = await convertToWebM(
          videoFile,
          selectedResolution > 0 ? selectedResolution : 0,
          (p) => setConversionProgress(p.percent)
        )
        uploadFile = new File([webmBlob], videoFile.name.replace(/\.[^.]+$/, '.webm'), { type: 'video/webm' })
        mimeType = 'video/webm'
      } catch (err: any) {
        setIsConverting(false)
        setStatusMessage('')
        setError(`Conversion failed: ${err.message}`)
        return
      }

      setIsConverting(false)
    }

    setStatusMessage('Generating poster frame...')
    try {
      const thumbnailBlob = await generateThumbnailFromVideo(uploadFile).catch(() => null)

      setUploadProgress(20)
      setStatusMessage('Calculating video hash...')
      const videoHash = await calculateSha256(uploadFile)

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
          videoUploadResult = await uploadMedia(signEvent, uploadFile, server)

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
        values.title || uploadFile.name,
        `${values.description} ${values.altText}`.trim(),
        tagsArray,
        mimeType
      )

      setUploadProgress(100)
      toast('Clip published!', 'success')
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
        <button className="text-[22px] leading-none" onClick={() => navigate(-1)}>×</button>
      </div>

      <div className="flex flex-1 flex-col gap-[17px] overflow-y-auto px-[18px] pb-[76px]">
        {error && <div className="rounded-[12px] border border-red-500/25 bg-red-500/10 p-3 text-[12px] text-red-300">{error}</div>}

        <div className="flex gap-[6px]">
          <span className={`rounded-[18px] px-[13px] py-[7px] text-[12px] font-medium ${videoFile ? 'bg-[#8b5cf6]/20 text-[#a78bfa]' : 'bg-[#f7f7f8] text-[#09090b] font-semibold'}`}>1 Select</span>
          <span className={`rounded-[18px] px-[13px] py-[7px] text-[12px] font-medium ${videoFile ? 'bg-[#f7f7f8] text-[#09090b] font-semibold' : 'bg-[#18181d] text-neutral-400'}`}>2 Details</span>
          <span className={`rounded-[18px] px-[13px] py-[7px] text-[12px] font-medium ${videoFile ? 'bg-[#8b5cf6]/20 text-[#a78bfa]' : 'bg-[#18181d] text-neutral-400'}`}>3 Publish</span>
        </div>

        {videoPreview ? (
          <div className="relative flex h-[350px] w-full flex-col items-center justify-center overflow-hidden rounded-[18px] bg-[#21172e]">
            <video src={videoPreview} className="h-full w-full rounded-[18px] object-cover" controls playsInline />
            <label className="absolute inset-0 cursor-pointer">
              <input type="file" accept="video/mp4,video/webm,video/quicktime,video/x-msvideo,video/x-matroska,video/ogg" className="hidden" onChange={handleFileChange} />
            </label>
          </div>
        ) : (
          <label className="flex h-[350px] w-full cursor-pointer flex-col items-center justify-center rounded-[18px] bg-[#21172e]">
            <span className="text-[14px] font-medium text-[#a1a1aa]">9:16 preview</span>
            <input type="file" accept="video/mp4,video/webm,video/quicktime,video/x-msvideo,video/x-matroska,video/ogg" className="hidden" onChange={handleFileChange} />
          </label>
        )}

        {videoFile && videoFile.type !== 'video/webm' && !isConverting && (
          <div className="flex items-center gap-3 rounded-[12px] bg-[#18181d] px-[14px] py-[10px]">
            <span className="text-[11px] font-medium text-[#a1a1aa]">Resolution</span>
            <label className="flex items-center gap-1.5 text-[13px]">
              <input type="radio" name="resolution" value={720}
                checked={selectedResolution === 720}
                onChange={() => setSelectedResolution(720)} />
              720p
            </label>
            <label className="flex items-center gap-1.5 text-[13px]">
              <input type="radio" name="resolution" value={1080}
                checked={selectedResolution === 1080}
                onChange={() => setSelectedResolution(1080)} />
              1080p
            </label>
            <label className="flex items-center gap-1.5 text-[13px]">
              <input type="radio" name="resolution" value={0}
                checked={selectedResolution === 0}
                onChange={() => setSelectedResolution(0)} />
              Original
            </label>
          </div>
        )}

        {videoFile && videoFile.size > 200 * 1024 * 1024 && (
          <div className="rounded-[12px] border border-amber-500/25 bg-amber-500/10 p-3 text-[12px] text-amber-300">
            Large file ({Math.round(videoFile.size / 1024 / 1024)} MB). Conversion may take a while.
          </div>
        )}

        {isConverting && (
          <div className="flex flex-col gap-2 rounded-[12px] bg-[#18181d] px-[14px] py-[10px]">
            <span className="text-[11px] font-medium text-[#a1a1aa]">Converting to WebM...</span>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#27272a]">
              <div className="h-1.5 rounded-full bg-[#8b5cf6] transition-all duration-300"
                style={{ width: `${conversionProgress}%` }} />
            </div>
            <span className="text-right text-[11px] text-[#a1a1aa]">{conversionProgress}%</span>
          </div>
        )}

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
          disabled={!session || !videoFile || isConverting || !!statusMessage}
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
