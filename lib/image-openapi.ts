import { readFileSync } from "node:fs"
import { join } from "node:path"

import { load as loadYaml } from "js-yaml"

import {
  getImageModelRegistryEntry,
  type ImageOpenapiRegistryEntry,
} from "@/lib/image-model-openapi"
import type {
  StudioImageFieldOption,
  StudioImageModelOption,
  StudioImageParameterField,
} from "@/lib/studio-types"

type OpenapiSchema = {
  type?: string | string[]
  enum?: unknown[]
  default?: unknown
  const?: unknown
  description?: string
  minimum?: number
  maximum?: number
  multipleOf?: number
  minLength?: number
  format?: string
  contentEncoding?: string
  properties?: Record<string, OpenapiSchema>
  required?: string[]
  items?: OpenapiSchema | OpenapiSchema[]
  oneOf?: OpenapiSchema[]
  anyOf?: OpenapiSchema[]
  allOf?: OpenapiSchema[]
  $ref?: string
}

type OpenapiContent = {
  schema?: OpenapiSchema
}

type OpenapiRequestBody = {
  required?: boolean
  content?: Record<string, OpenapiContent>
}

type OpenapiOperation = {
  operationId?: string
  requestBody?: OpenapiRequestBody
}

type OpenapiPathItem = Record<string, OpenapiOperation>

type OpenapiDocument = {
  paths?: Record<string, OpenapiPathItem>
  components?: {
    schemas?: Record<string, OpenapiSchema>
  }
}

type CacheEntry = {
  modelOption: Omit<StudioImageModelOption, "id" | "name" | "label" | "manufacturer" | "inputModalities" | "outputModalities" | "coverUrl">
}

const documentCache = new Map<string, OpenapiDocument>()
const optionCache = new Map<string, CacheEntry>()

const ADVANCED_FIELDS = new Set([
  "stream",
  "watermark",
  "response_format",
  "webhook_url",
  "webhook_secret",
  "optimize_prompt_options",
  "safety_tolerance",
  "output_compression",
  "thinking_mode",
  "enable_sequential",
  "sequential_image_generation",
  "sequential_image_generation_options",
  "tools",
  "input_tokens_details",
])

const IMAGE_INPUT_FIELDS = new Set([
  "image",
  "images",
  "image[]",
  "input_image",
  "input_image_2",
  "input_image_3",
  "input_image_4",
  "input_image_5",
  "input_image_6",
  "input_image_7",
  "input_image_8",
  "mask",
])

function loadDocument(file: string): OpenapiDocument {
  const cached = documentCache.get(file)

  if (cached) {
    return cached
  }

  const absolute = join(process.cwd(), file)
  const text = readFileSync(absolute, "utf8")
  const parsed = loadYaml(text) as OpenapiDocument

  documentCache.set(file, parsed)
  return parsed
}

function resolveRef(
  document: OpenapiDocument,
  ref: string
): OpenapiSchema | undefined {
  if (!ref.startsWith("#/")) {
    return undefined
  }

  const segments = ref.slice(2).split("/")
  let cursor: unknown = document

  for (const segment of segments) {
    if (!cursor || typeof cursor !== "object") {
      return undefined
    }

    cursor = (cursor as Record<string, unknown>)[segment]
  }

  return cursor as OpenapiSchema | undefined
}

function resolveSchema(
  document: OpenapiDocument,
  schema: OpenapiSchema | undefined,
  seen: Set<string> = new Set()
): OpenapiSchema | undefined {
  if (!schema) {
    return undefined
  }

  if (schema.$ref) {
    if (seen.has(schema.$ref)) {
      return undefined
    }

    seen.add(schema.$ref)
    const target = resolveRef(document, schema.$ref)
    return resolveSchema(document, target, seen)
  }

  return schema
}

function findOperation(
  document: OpenapiDocument,
  operationId: string
): { path: string; method: string; operation: OpenapiOperation } | undefined {
  const paths = document.paths ?? {}

  for (const [path, pathItem] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (operation?.operationId === operationId) {
        return { path, method, operation }
      }
    }
  }

  return undefined
}

function inferType(schema: OpenapiSchema): string {
  if (Array.isArray(schema.type)) {
    return schema.type.find((value) => value !== "null") ?? "string"
  }

  return schema.type ?? "string"
}

function getEnumOptions(
  schema: OpenapiSchema
): StudioImageFieldOption[] | undefined {
  const values = schema.enum ?? schema.oneOf?.flatMap((item) => item.enum ?? [])

  if (!values || values.length === 0) {
    return undefined
  }

  return values
    .filter(
      (value) =>
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
    )
    .map((value) => ({
      value: String(value),
      label: String(value),
    }))
}

function getOneOfEnumOptions(
  schema: OpenapiSchema
): StudioImageFieldOption[] | undefined {
  if (!schema.oneOf) {
    return undefined
  }

  const options: StudioImageFieldOption[] = []

  for (const child of schema.oneOf) {
    if (child.enum) {
      for (const value of child.enum) {
        if (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        ) {
          options.push({ value: String(value), label: String(value) })
        }
      }
    }
  }

  return options.length > 0 ? options : undefined
}

function isImageField(name: string, schema: OpenapiSchema): boolean {
  if (IMAGE_INPUT_FIELDS.has(name)) {
    return true
  }

  if (schema.contentEncoding === "base64") {
    return true
  }

  if (schema.format === "binary") {
    return true
  }

  return false
}

function fieldKindFromSchema(
  name: string,
  schema: OpenapiSchema,
  options?: StudioImageFieldOption[]
): StudioImageParameterField["kind"] {
  if (name === "prompt") {
    return "prompt"
  }

  if (isImageField(name, schema)) {
    return "image"
  }

  const type = inferType(schema)

  if (type === "boolean") {
    return "boolean"
  }

  if (options && options.length > 0) {
    return "select"
  }

  if (type === "integer" || type === "number") {
    if (
      typeof schema.minimum === "number" &&
      typeof schema.maximum === "number"
    ) {
      return "slider"
    }
    return "number"
  }

  return "text"
}

function buildField(
  document: OpenapiDocument,
  name: string,
  rawSchema: OpenapiSchema,
  required: boolean
): StudioImageParameterField | null {
  const schema = resolveSchema(document, rawSchema)

  if (!schema) {
    return null
  }

  const constValue = schema.const

  if (constValue !== undefined) {
    return {
      name,
      label: name,
      kind: "text",
      required,
      advanced: false,
      hidden: true,
      constantValue:
        typeof constValue === "string" ||
        typeof constValue === "number" ||
        typeof constValue === "boolean"
          ? constValue
          : String(constValue),
    }
  }

  const options =
    getEnumOptions(schema) ?? getOneOfEnumOptions(schema) ?? undefined
  const kind = fieldKindFromSchema(name, schema, options)
  const advanced = ADVANCED_FIELDS.has(name)

  const baseField: StudioImageParameterField = {
    name,
    label: name,
    kind,
    required,
    advanced,
    hidden: false,
  }

  if (options) {
    baseField.options = options
  }

  if (
    typeof schema.default === "string" ||
    typeof schema.default === "number" ||
    typeof schema.default === "boolean"
  ) {
    baseField.defaultValue = schema.default
  }

  if (typeof schema.minimum === "number") {
    baseField.min = schema.minimum
  }

  if (typeof schema.maximum === "number") {
    baseField.max = schema.maximum
  }

  if (typeof schema.multipleOf === "number") {
    baseField.multipleOf = schema.multipleOf
    baseField.step = schema.multipleOf
  } else if (kind === "slider" && typeof schema.minimum === "number") {
    baseField.step = inferType(schema) === "integer" ? 1 : 0.1
  }

  if (kind === "image") {
    const isArray =
      inferType(schema) === "array" || name === "images" || name === "image[]"
    baseField.acceptMultiple = isArray
    baseField.acceptUrl =
      inferType(schema) === "string" ||
      name === "images" ||
      name === "image" ||
      name === "input_image" ||
      name === "input_image_2" ||
      name === "input_image_3" ||
      name === "input_image_4" ||
      name === "input_image_5" ||
      name === "input_image_6" ||
      name === "input_image_7" ||
      name === "input_image_8"
  }

  return baseField
}

function extractRequestBodySchema(
  document: OpenapiDocument,
  entry: ImageOpenapiRegistryEntry
): OpenapiSchema | undefined {
  const operation = findOperation(document, entry.operationId)

  if (!operation) {
    return undefined
  }

  const content = operation.operation.requestBody?.content
  const body = content?.[entry.contentType]

  return resolveSchema(document, body?.schema)
}

function buildFieldsForGemini(): StudioImageParameterField[] {
  return [
    {
      name: "prompt",
      label: "prompt",
      kind: "prompt",
      required: true,
      advanced: false,
      hidden: false,
    },
    {
      name: "aspectRatio",
      label: "aspectRatio",
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
      kind: "select",
      required: false,
      advanced: false,
      hidden: false,
      options: [
        { value: "1K", label: "1K" },
        { value: "2K", label: "2K" },
      ],
      defaultValue: "1K",
    },
    {
      name: "responseModalities",
      label: "responseModalities",
      kind: "text",
      required: false,
      advanced: false,
      hidden: true,
      constantValue: "TEXT,IMAGE",
    },
    {
      name: "image",
      label: "image",
      kind: "image",
      required: false,
      advanced: true,
      hidden: false,
      acceptMultiple: false,
      acceptUrl: true,
    },
  ]
}

function extractFields(
  document: OpenapiDocument,
  entry: ImageOpenapiRegistryEntry
): StudioImageParameterField[] {
  if (entry.adapter === "gemini-generate-content") {
    return buildFieldsForGemini()
  }

  const schema = extractRequestBodySchema(document, entry)

  if (!schema || !schema.properties) {
    return []
  }

  const required = new Set(schema.required ?? [])
  const fields: StudioImageParameterField[] = []

  for (const [name, propertySchema] of Object.entries(schema.properties)) {
    const field = buildField(
      document,
      name,
      propertySchema,
      required.has(name)
    )

    if (field) {
      fields.push(field)
    }
  }

  return sortFields(fields)
}

function fieldRank(field: StudioImageParameterField) {
  if (field.name === "prompt") {
    return 0
  }
  if (field.kind === "image") {
    return 1
  }
  if (field.name === "size") {
    return 2
  }
  if (field.name === "n") {
    return 3
  }
  if (field.advanced) {
    return 10
  }
  return 5
}

function sortFields(fields: StudioImageParameterField[]) {
  return [...fields].sort((left, right) => {
    const rank = fieldRank(left) - fieldRank(right)
    if (rank !== 0) {
      return rank
    }
    return left.name.localeCompare(right.name)
  })
}

export function loadImageModelFields(
  modelKey: string
): StudioImageParameterField[] {
  const entry = getImageModelRegistryEntry(modelKey)

  if (!entry?.openapi) {
    return []
  }

  const cacheKey = `${entry.openapi.file}#${entry.openapi.operationId}`
  const cached = optionCache.get(cacheKey)

  if (cached) {
    return cached.modelOption.fields
  }

  const document = loadDocument(entry.openapi.file)
  const fields = extractFields(document, entry.openapi)

  optionCache.set(cacheKey, {
    modelOption: {
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
      fields,
    },
  })

  return fields
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

  const fields = loadImageModelFields(name)

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
    fields,
  }
}
