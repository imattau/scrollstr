import React, { useState } from 'react'
import { Upload, Film, FileText, CheckCircle2, ChevronRight, Settings } from 'lucide-react'

export const PostWizard: React.FC = () => {
  const [step, setStep] = useState(1)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoPreview, setVideoPreview] = useState<string>('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [hashtags, setHashtags] = useState('')
  const [uploadProgress, setUploadProgress] = useState(0)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      if (!file.type.startsWith('video/')) {
        alert('Please select a valid MP4/video file')
        return
      }
      setVideoFile(file)
      setVideoPreview(URL.createObjectURL(file))
      setStep(2)
    }
  }

  const handlePublish = () => {
    setStep(3)
    // Simulate upload
    const interval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval)
          setStep(4)
          return 100
        }
        return prev + 10
      })
    }, 200)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-neutral-900">
        <h2 className="text-xl font-bold">Publish Clip</h2>
        <span className="text-xs text-neutral-400 font-semibold">Step {step} of 4</span>
      </div>

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
            className="w-full flex items-center justify-center gap-2 py-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-xl text-xs transition-all shadow-lg shadow-purple-600/25"
          >
            <span>Publish to Blossom & Relays</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col items-center justify-center py-10 space-y-6">
          <Film className="w-12 h-12 text-purple-500 animate-spin" />
          <div className="text-center">
            <h3 className="font-bold text-neutral-200">Uploading Video</h3>
            <p className="text-xs text-neutral-500 mt-1">Hashing and transferring to Blossom media servers...</p>
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
