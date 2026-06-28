import { IMAGE_OPENAPI_FIELDS } from "@/lib/generated/image-openapi-fields"
import {
  getImageModelDisplayName,
  getImageModelRegistryEntry,
  type ImageOpenapiRegistryEntry,
} from "@/lib/image-model-openapi"
import type {
  StudioImageModelOption,
  StudioImageModelOperation,
  StudioImageParameterField,
} from "@/lib/studio-types"

const generatedFields = IMAGE_OPENAPI_FIELDS as Record<
  string,
  StudioImageParameterField[]
>

function cloneFields(fields: StudioImageParameterField[]) {
  return fields.map((field) => ({
    ...field,
    options: field.options?.map((option) => ({
      ...option,
      label:
        field.name === "model"
          ? getImageModelDisplayName(option.value, option.label)
          : option.label,
    })),
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

function getGeminiAspectRatioFieldConfig(entry: ImageOpenapiRegistryEntry) {
  if (
    entry.operationId === "generateGemini31FlashImageContent" ||
    entry.operationId === "generateGemini3ProImageContent"
  ) {
    return {
      description: "Output image aspect ratio.",
      options: [
        { value: "1:1", label: "1:1" },
        { value: "2:3", label: "2:3" },
        { value: "3:2", label: "3:2" },
        { value: "3:4", label: "3:4" },
        { value: "4:3", label: "4:3" },
        { value: "4:5", label: "4:5" },
        { value: "5:4", label: "5:4" },
        { value: "9:16", label: "9:16" },
        { value: "16:9", label: "16:9" },
        { value: "21:9", label: "21:9" },
      ],
    }
  }

  return {
    description: "Aspect ratio for generated images.",
    options: [
      { value: "1:1", label: "1:1" },
      { value: "4:3", label: "4:3" },
      { value: "3:4", label: "3:4" },
      { value: "16:9", label: "16:9" },
      { value: "9:16", label: "9:16" },
    ],
  }
}

function buildFieldsForGemini(
  entry: ImageOpenapiRegistryEntry
): StudioImageParameterField[] {
  const aspectRatioConfig = getGeminiAspectRatioFieldConfig(entry)
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
      description: aspectRatioConfig.description,
      kind: "select",
      required: false,
      advanced: false,
      hidden: false,
      options: aspectRatioConfig.options,
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

function fieldsForOpenapiEntry(
  entry: ImageOpenapiRegistryEntry,
  modelKey: string
) {
  if (entry.adapter === "gemini-generate-content") {
    return buildFieldsForGemini(entry)
  }

  const key = getGeneratedFieldsKey(entry, modelKey)
  return cloneFields(generatedFields[key] ?? [])
}

function fieldsForGptImage2Edit(entry: ImageOpenapiRegistryEntry) {
  const fields = fieldsForOpenapiEntry(entry, "gpt-image-2")
  const singleImage = fields.find((field) => field.name === "image")
  const multipleImages = fields.find((field) => field.name === "image[]")

  return fields.map((field) => {
    if (field.name === "image[]") {
      return {
        ...field,
        description: [singleImage?.description, multipleImages?.description]
          .filter(Boolean)
          .join("\n"),
        required: true,
        advanced: false,
        hidden: false,
        acceptMultiple: true,
        acceptUrl: true,
      }
    }

    if (field.name === "image" || field.name === "mask") {
      return {
        ...field,
        hidden: true,
      }
    }

    return field
  })
}

export function loadImageModelOperationFields(
  modelKey: string,
  operationId?: string
): StudioImageParameterField[] {
  const entry = getImageModelRegistryEntry(modelKey)

  if (!entry?.openapi) {
    return []
  }

  const openapi =
    [entry.openapi, entry.editOpenapi].find(
      (operation) => operation?.operationId === operationId
    ) ?? entry.openapi

  if (modelKey === "gpt-image-2" && openapi.adapter === "openai-images-edit") {
    return fieldsForGptImage2Edit(openapi)
  }

  return fieldsForOpenapiEntry(openapi, modelKey)
}

export function loadImageModelFields(modelKey: string) {
  return loadImageModelOperationFields(modelKey)
}

function studioOpenapi(entry: ImageOpenapiRegistryEntry) {
  return {
    file: entry.file,
    operationId: entry.operationId,
    method: entry.method,
    path: entry.path,
    contentType: entry.contentType,
    adapter: entry.adapter,
  }
}

function imageOperation({
  id,
  entry,
  modelKey,
  requiresReferenceImages,
}: {
  id: StudioImageModelOperation["id"]
  entry: ImageOpenapiRegistryEntry
  modelKey: string
  requiresReferenceImages: boolean
}): StudioImageModelOperation {
  return {
    id,
    openapi: studioOpenapi(entry),
    fields: loadImageModelOperationFields(modelKey, entry.operationId),
    requiresReferenceImages,
  }
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
  const displayLabel = getImageModelDisplayName(
    name,
    getImageModelDisplayName(id, label)
  )

  if (!entry) {
    return {
      id,
      name,
      label: displayLabel,
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
      label: displayLabel,
      manufacturer,
      inputModalities,
      outputModalities,
      coverUrl,
      supported: false,
      disabledReason: entry.disabledReason ?? "missing-openapi",
      fields: [],
    }
  }

  const operations: StudioImageModelOperation[] = [
    imageOperation({
      id: "generation",
      entry: entry.openapi,
      modelKey: name,
      requiresReferenceImages: false,
    }),
  ]

  if (entry.editOpenapi) {
    operations.push(
      imageOperation({
        id: "edit",
        entry: entry.editOpenapi,
        modelKey: name,
        requiresReferenceImages: true,
      })
    )
  }

  const primaryOperation = operations[0]

  return {
    id,
    name,
    label: displayLabel,
    manufacturer,
    inputModalities,
    outputModalities,
    coverUrl,
    supported: entry.supported,
    disabledReason: entry.disabledReason,
    openapi: primaryOperation.openapi,
    operations,
    fields: primaryOperation.fields,
  }
}
