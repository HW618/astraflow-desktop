import { IMAGE_OPENAPI_FIELDS } from "@/lib/generated/image-openapi-fields"
import {
  getImageModelRegistryEntry,
  type ImageOpenapiRegistryEntry,
} from "@/lib/image-model-openapi"
import type {
  StudioImageModelOption,
  StudioImageParameterField,
} from "@/lib/studio-types"

const generatedFields = IMAGE_OPENAPI_FIELDS as Record<
  string,
  StudioImageParameterField[]
>

function cloneFields(fields: StudioImageParameterField[]) {
  return fields.map((field) => ({
    ...field,
    options: field.options?.map((option) => ({ ...option })),
    suggestedValues: field.suggestedValues?.map((option) => ({ ...option })),
  }))
}

function getGeminiImageSizeFieldConfig(entry: ImageOpenapiRegistryEntry) {
  if (entry.operationId === "generateGemini31FlashImageContent") {
    return {
      description:
        "Image resolution. Supports `512` (0.5K, without a `K` suffix), `1K`, `2K`, and `4K`.",
      options: [
        { value: "512", label: "512" },
        { value: "1K", label: "1K" },
        { value: "2K", label: "2K" },
        { value: "4K", label: "4K" },
      ],
    }
  }

  if (entry.operationId === "generateGemini3ProImageContent") {
    return {
      description: "Image resolution. Supports `1K`, `2K`, and `4K`.",
      options: [
        { value: "1K", label: "1K" },
        { value: "2K", label: "2K" },
        { value: "4K", label: "4K" },
      ],
    }
  }

  return {
    description: "Image size for generated images.",
    options: [
      { value: "1K", label: "1K" },
      { value: "2K", label: "2K" },
    ],
  }
}

function buildFieldsForGemini(
  entry: ImageOpenapiRegistryEntry
): StudioImageParameterField[] {
  const imageSizeConfig = getGeminiImageSizeFieldConfig(entry)

  return [
    {
      name: "prompt",
      label: "prompt",
      description: "Prompt text.",
      kind: "prompt",
      required: true,
      advanced: false,
      hidden: false,
    },
    {
      name: "aspectRatio",
      label: "aspectRatio",
      description: "Aspect ratio for generated images.",
      kind: "select",
      required: false,
      advanced: false,
      hidden: false,
      options: [
        { value: "1:1", label: "1:1" },
        { value: "4:3", label: "4:3" },
        { value: "3:4", label: "3:4" },
        { value: "16:9", label: "16:9" },
        { value: "9:16", label: "9:16" },
      ],
      defaultValue: "1:1",
    },
    {
      name: "imageSize",
      label: "imageSize",
      description: imageSizeConfig.description,
      kind: "select",
      required: false,
      advanced: false,
      hidden: false,
      options: imageSizeConfig.options,
      defaultValue: "1K",
    },
    {
      name: "responseModalities",
      label: "responseModalities",
      description: "Response modalities requested from the model.",
      kind: "text",
      required: false,
      advanced: false,
      hidden: true,
      constantValue: "TEXT,IMAGE",
    },
    {
      name: "image",
      label: "image",
      description: "Optional reference image input.",
      kind: "image",
      required: false,
      advanced: true,
      hidden: false,
      acceptMultiple: false,
      acceptUrl: true,
    },
  ]
}

function getGeneratedFieldsKey(
  entry: ImageOpenapiRegistryEntry,
  modelKey: string
) {
  const baseKey = `${entry.file}#${entry.operationId}`
  const variantKeys = [
    entry.modelConstant ? `${baseKey}:${entry.modelConstant}` : null,
    `${baseKey}:${modelKey}`,
    baseKey,
  ].filter((key): key is string => Boolean(key))

  return variantKeys.find((key) => generatedFields[key]) ?? baseKey
}

export function loadImageModelFields(
  modelKey: string
): StudioImageParameterField[] {
  const entry = getImageModelRegistryEntry(modelKey)

  if (!entry?.openapi) {
    return []
  }

  if (entry.openapi.adapter === "gemini-generate-content") {
    return buildFieldsForGemini(entry.openapi)
  }

  const key = getGeneratedFieldsKey(entry.openapi, modelKey)

  return cloneFields(generatedFields[key] ?? [])
}

export function buildImageModelOption({
  id,
  name,
  label,
  manufacturer,
  inputModalities,
  outputModalities,
  coverUrl,
}: {
  id: string
  name: string
  label: string
  manufacturer: string
  inputModalities: string[]
  outputModalities: string[]
  coverUrl: string | null
}): StudioImageModelOption {
  const entry = getImageModelRegistryEntry(name) ?? getImageModelRegistryEntry(id)

  if (!entry) {
    return {
      id,
      name,
      label,
      manufacturer,
      inputModalities,
      outputModalities,
      coverUrl,
      supported: false,
      disabledReason: "missing-openapi",
      fields: [],
    }
  }

  if (!entry.openapi) {
    return {
      id,
      name,
      label,
      manufacturer,
      inputModalities,
      outputModalities,
      coverUrl,
      supported: false,
      disabledReason: entry.disabledReason ?? "missing-openapi",
      fields: [],
    }
  }

  return {
    id,
    name,
    label,
    manufacturer,
    inputModalities,
    outputModalities,
    coverUrl,
    supported: entry.supported,
    disabledReason: entry.disabledReason,
    openapi: {
      file: entry.openapi.file,
      operationId: entry.openapi.operationId,
      method: entry.openapi.method,
      path: entry.openapi.path,
      contentType: entry.openapi.contentType,
      adapter: entry.openapi.adapter,
    },
    fields: loadImageModelFields(name),
  }
}
