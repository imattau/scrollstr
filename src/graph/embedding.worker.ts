import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'

type Request = { id: number; text: string; model: string; device: 'wasm' | 'webgpu' }
type Response = { id: number; vector?: number[]; error?: string }

const scope = self as unknown as {
  postMessage(message: Response): void
  onmessage: ((event: MessageEvent<Request>) => void) | null
}

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null
let loadedModel = ''
let loadedDevice: Request['device'] | null = null

async function getExtractor(model: string, device: Request['device']) {
  if (!extractorPromise || model !== loadedModel || device !== loadedDevice) {
    loadedModel = model
    loadedDevice = device
    extractorPromise = (pipeline as unknown as (
      task: string,
      model: string,
      options: Record<string, unknown>,
    ) => Promise<FeatureExtractionPipeline>)('feature-extraction', model, {
      device,
      // Some WebGPU implementations expose the API but do not support fp16.
      // fp32 is slower but broadly supported; WASM keeps the smaller q4 path.
      dtype: device === 'webgpu' ? 'fp32' : 'q4',
    })
  }
  return extractorPromise
}

scope.onmessage = async ({ data }) => {
  try {
    const extractor = await getExtractor(data.model, data.device)
    const output = await extractor(data.text, { pooling: 'mean', normalize: true })
  scope.postMessage({ id: data.id, vector: Array.from(output.data as ArrayLike<number>) })
  } catch (error) {
    scope.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : 'Browser embedding failed.',
    })
  }
}
