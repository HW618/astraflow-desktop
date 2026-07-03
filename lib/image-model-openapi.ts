import { MODELVERSE_BASE_URL } from "@/lib/modelverse-config"
import type {
  StudioImageAdapter,
  StudioImageDisabledReason,
} from "@/lib/studio-types"

export type ImageOpenapiRegistryEntry = {
  file: string
  operationId: string
  method: "POST" | "GET"
  path: string
  contentType: "application/json" | "multipart/form-data"
  adapter: StudioImageAdapter
  modelConstant?: string
  endpointUrl?: string
}

export type ImageModelRegistryEntry = {
  supported: boolean
  openapi?: ImageOpenapiRegistryEntry
  editOpenapi?: ImageOpenapiRegistryEntry
  disabledReason?: StudioImageDisabledReason
}


const IMAGE_MODEL_DISPLAY_NAMES: Record<string, string> = {
  "doubao-seedream-4.5": "Doubao Seeadream 4.5",
  "doubao-seedream-5-0-260128": "Doubao Seeadream 5.0",
  "flux-2-pro": "FLUX 2 Pro",
  "gemini-2.5-flash-image": "Gemini 2.5 Flash Image (Nano Banana)",
  "gemini-3.1-flash-image": "Gemini 3.1 Flash Image (Nano Banana 2)",
  "gemini-3.1-flash-image-preview": "Gemini 3.1 Flash Image Preview (Nano Banana 2)",
  "gemini-3-pro-image": "Gemini 3 Pro Image (Nano Banana Pro)",
  "gemini-3-pro-image-preview": "Gemini 3 Pro Image Preview(Nano Banana Pro)",
  "gpt-image-2": "GPT Image 2",
  "midjourney-fast-imagine": "Midjourney Fast Imagine",
  "Qwen/Qwen-Image": "Qwen Image",
  "Qwen/Qwen-Image-Edit": "Qwen Image Edit",
  "stepfun-ai/step1x-edit": "Stepfun Step1X Edit",
  "wan2.7-image": "WAN 2.7 Image",
  "wan2.7-image-pro": "WAN 2.7 Image Pro",
}

const doubaoSeedream: ImageOpenapiRegistryEntry = {
  file: "openapi/image/doubao-seedream.yaml",
  operationId: "createDoubaoSeedreamImageGeneration",
  method: "POST",
  path: "/v1/images/generations",
  contentType: "application/json",
  adapter: "openai-images",
}

const flux2Pro: ImageOpenapiRegistryEntry = {
  file: "openapi/image/flux-2-pro.yaml",
  operationId: "createFlux2ProImageGeneration",
  method: "POST",
  path: "/v1/flux-2-pro",
  contentType: "application/json",
  adapter: "custom-json",
}

const gemini25Flash: ImageOpenapiRegistryEntry = {
  file: "openapi/image/gemini-2.5-flash-image.yaml",
  operationId: "generateContentGemini25FlashImage",
  method: "POST",
  path: "/v1beta/models/gemini-2.5-flash-image:generateContent",
  contentType: "application/json",
  adapter: "gemini-generate-content",
  modelConstant: "gemini-2.5-flash-image",
}

const gemini31Flash: ImageOpenapiRegistryEntry = {
  file: "openapi/image/gemini-3.1-flash-image.yaml",
  operationId: "generateGemini31FlashImageContent",
  method: "POST",
  path: "/v1beta/models/gemini-3.1-flash-image-preview:generateContent",
  contentType: "application/json",
  adapter: "gemini-generate-content",
  modelConstant: "gemini-3.1-flash-image-preview",
}

const gemini3Pro: ImageOpenapiRegistryEntry = {
  file: "openapi/image/gemini-3-pro-image.yaml",
  operationId: "generateGemini3ProImageContent",
  method: "POST",
  path: "/v1beta/models/gemini-3-pro-image-preview:generateContent",
  contentType: "application/json",
  adapter: "gemini-generate-content",
  modelConstant: "gemini-3-pro-image-preview",
}

const qwenImage: ImageOpenapiRegistryEntry = {
  file: "openapi/image/Qwen-Qwen-Image.yaml",
  operationId: "createQwenQwenImageGeneration",
  method: "POST",
  path: "/v1/images/generations",
  contentType: "application/json",
  adapter: "openai-images",
  modelConstant: "Qwen/Qwen-Image",
}

const qwenImageEdit: ImageOpenapiRegistryEntry = {
  file: "openapi/image/Qwen-Qwen-Image-Edit.yaml",
  operationId: "createQwenQwenImageEditImageGeneration",
  method: "POST",
  path: "/v1/images/generations",
  contentType: "application/json",
  adapter: "openai-images",
  modelConstant: "Qwen/Qwen-Image-Edit",
}

const stepfunEdit: ImageOpenapiRegistryEntry = {
  file: "openapi/image/stepfun-ai-step1x-edit.yaml",
  operationId: "createStepfunStep1xEditImageGeneration",
  method: "POST",
  path: "/v1/images/generations",
  contentType: "application/json",
  adapter: "openai-images",
  modelConstant: "stepfun-ai/step1x-edit",
}

const wan27: ImageOpenapiRegistryEntry = {
  file: "openapi/image/Wan-AI-Wan2.7-Image.yaml",
  operationId: "createWanAIWan27ImageGeneration",
  method: "POST",
  path: "/v1/images/generations",
  contentType: "application/json",
  adapter: "openai-images",
}

const gptImage2: ImageOpenapiRegistryEntry = {
  file: "openapi/image/gpt-image-2.yaml",
  operationId: "createGptImage2ImageGeneration",
  method: "POST",
  path: "/v1/images/generations",
  contentType: "application/json",
  adapter: "openai-images",
  modelConstant: "gpt-image-2",
}

const gptImage2Edit: ImageOpenapiRegistryEntry = {
  file: "openapi/image/gpt-image-2.yaml",
  operationId: "createGptImage2ImageEdit",
  method: "POST",
  path: "/v1/images/edits",
  contentType: "multipart/form-data",
  adapter: "openai-images-edit",
  modelConstant: "gpt-image-2",
}

const midjourneyImagine: ImageOpenapiRegistryEntry = {
  file: "openapi/image/midjourney.yaml",
  operationId: "submitMidjourneyTask",
  method: "POST",
  path: "/v1/tasks/submit",
  contentType: "application/json",
  adapter: "async-task",
}

export const IMAGE_MODEL_REGISTRY: Record<string, ImageModelRegistryEntry> = {
  "doubao-seedream-4.5": { supported: true, openapi: doubaoSeedream },
  "doubao-seedream-5-0-260128": { supported: true, openapi: doubaoSeedream },
  "flux-2-pro": { supported: true, openapi: flux2Pro },
  "flux-kontext-pro": { supported: false, disabledReason: "missing-openapi" },
  "flux-pro-1.1": { supported: false, disabledReason: "missing-openapi" },
  "gemini-2.5-flash-image": { supported: true, openapi: gemini25Flash },
  "gemini-3.1-flash-image": { supported: true, openapi: gemini31Flash },
  "gemini-3.1-flash-image-preview": { supported: true, openapi: gemini31Flash },
  "Qwen/Qwen-Image": { supported: true, openapi: qwenImage },
  "Qwen/Qwen-Image-Edit": {
    supported: false,
    disabledReason: "edit-only",
    openapi: qwenImageEdit,
  },
  "stepfun-ai/step1x-edit": {
    supported: false,
    disabledReason: "edit-only",
    openapi: stepfunEdit,
  },
  "wan2.7-image": { supported: true, openapi: wan27 },
  "wan2.7-image-pro": { supported: true, openapi: wan27 },
  "gemini-3-pro-image": { supported: true, openapi: gemini3Pro },
  "gemini-3-pro-image-preview": { supported: true, openapi: gemini3Pro },
  "gpt-image-1": { supported: false, disabledReason: "missing-openapi" },
  "gpt-image-1-mini": { supported: false, disabledReason: "missing-openapi" },
  "gpt-image-1.5": { supported: false, disabledReason: "missing-openapi" },
  "gpt-image-2": {
    supported: true,
    openapi: gptImage2,
    editOpenapi: gptImage2Edit,
  },
  "midjourney-fast-imagine": { supported: true, openapi: midjourneyImagine },
  "midjourney-fast-reroll": {
    supported: false,
    disabledReason: "follow-up-only",
  },
  "midjourney-fast-upscale": {
    supported: false,
    disabledReason: "follow-up-only",
  },
  "midjourney-fast-variation": {
    supported: false,
    disabledReason: "follow-up-only",
  },
  "mimo-v2.5": { supported: false, disabledReason: "missing-openapi" },
}

export function normalizeImageModelKey(modelId: string) {
  return modelId.trim()
}

export function getImageModelRegistryEntry(modelId: string) {
  const normalized = normalizeImageModelKey(modelId)

  if (IMAGE_MODEL_REGISTRY[normalized]) {
    return IMAGE_MODEL_REGISTRY[normalized]
  }

  const fallback = normalized.replace(/^publishers\/google\/models\//, "")

  return IMAGE_MODEL_REGISTRY[fallback]
}

export function getImageModelDisplayName(modelId: string, fallback = modelId) {
  const normalized = normalizeImageModelKey(modelId)
  const publisherFallback = normalized.replace(/^publishers\/google\/models\//, "")

  return (
    IMAGE_MODEL_DISPLAY_NAMES[normalized] ??
    IMAGE_MODEL_DISPLAY_NAMES[publisherFallback] ??
    fallback.trim() ??
    modelId
  )
}

export function getImageModelEndpoint(
  entry: ImageOpenapiRegistryEntry,
  modelId: string
) {
  if (entry.adapter === "gemini-generate-content") {
    const modelSlug = entry.modelConstant ?? modelId
    return `${MODELVERSE_BASE_URL}/v1beta/models/${modelSlug}:generateContent`
  }

  return `${MODELVERSE_BASE_URL}${entry.path}`
}

export function getImageModelConstantForRequest(
  entry: ImageOpenapiRegistryEntry,
  modelId: string
) {
  return entry.modelConstant ?? modelId
}
