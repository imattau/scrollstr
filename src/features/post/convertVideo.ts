import type { FFmpeg } from '@ffmpeg/ffmpeg'

export const SUPPORTED_INPUT_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/ogg',
]

export function isSupportedVideo(file: File): boolean {
  return SUPPORTED_INPUT_TYPES.includes(file.type)
}

let ffmpegInstance: FFmpeg | null = null
let ffmpegReady: Promise<FFmpeg> | null = null

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance
  if (ffmpegReady) return ffmpegReady

  ffmpegReady = (async () => {
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
      import('@ffmpeg/ffmpeg'),
      import('@ffmpeg/util'),
    ])

    const ffmpeg = new FFmpeg()

    const base = '/ffmpeg-core'
    await ffmpeg.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
    })

    ffmpegInstance = ffmpeg
    return ffmpeg
  })()

  return ffmpegReady
}

export interface ConversionProgress {
  percent: number
}

export async function convertToWebM(
  file: File,
  resolution: number,
  onProgress?: (p: ConversionProgress) => void
): Promise<Blob> {
  const ffmpeg = await getFFmpeg()

  const inputName = 'input'
  const outputName = 'output.webm'

  ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()))

  const scaleFilter = resolution > 0
    ? `scale='min(iw,${resolution})':'min(ih,${resolution})':force_original_aspect_ratio=decrease`
    : undefined

  const args = ['-i', inputName, '-c:v', 'libvpx-vp9', '-c:a', 'libopus']
  if (scaleFilter) {
    args.push('-vf', scaleFilter)
  }
  args.push('-deadline', 'realtime', '-cpu-used', '2', '-crf', '32', '-b:v', '0', '-y', outputName)

  const onFfmpegProgress = ({ progress }: { progress: number }) => {
    onProgress?.({ percent: Math.round(progress * 100) })
  }
  if (onProgress) {
    ffmpeg.on('progress', onFfmpegProgress)
  }

  await ffmpeg.exec(args)

  const data = await ffmpeg.readFile(outputName)
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'video/webm' })

  ffmpeg.deleteFile(inputName)
  ffmpeg.deleteFile(outputName)

  if (onProgress) {
    ffmpeg.off('progress', onFfmpegProgress)
  }

  return blob
}
