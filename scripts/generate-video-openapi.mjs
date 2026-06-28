#!/usr/bin/env bun

import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { basename, join, relative, sep } from "node:path"

import { dereference } from "@readme/openapi-parser"

const root = process.cwd()
const openapiDir = join(root, "openapi/video")
const generatedDir = join(root, "lib/generated")
const generatedTypesDir = join(generatedDir, "openapi/video")
const metadataFile = join(generatedDir, "video-openapi-fields.ts")
const openapiTypescriptBin = join(
  root,
  "node_modules/.bin/openapi-typescript"
)

const ADVANCED_FIELDS = new Set([
  "negative_prompt",
  "seed",
  "guidance_scale",
  "prompt_optimizer",
  "prompt_extend",
  "watermark",
  "bgm",
  "generate_audio",
  "camera_control",
  "movement_amplitude",
  "audio_url",
  "video_url",
  "reference_audio",
  "reference_video",
  "webhook_url",
  "webhook_secret",
])

const IMAGE_INPUT_FIELDS = new Set([
  "image",
  "images",
  "img_url",
  "image_url",
  "first_frame_url",
  "last_frame_url",
  "last_frame",
  "input_reference",
  "reference_image",
  "reference_images",
  "subject_reference",
  "subject_references",
])

const VIDEO_INPUT_FIELDS = new Set([
  "video",
  "video_url",
  "videos",
  "reference_video",
])

const AUDIO_INPUT_FIELDS = new Set([
  "audio",
  "audio_url",
  "reference_audio",
])

function toProjectPath(absolutePath) {
  return relative(root, absolutePath).split(sep).join("/")
}

function toGeneratedTypeName(file) {
  return basename(file, ".yaml").replace(/[^A-Za-z0-9_-]/g, "-")
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function inferType(schema) {
  if (Array.isArray(schema?.type)) {
    return schema.type.find((value) => value !== "null") ?? "string"
  }

  return schema?.type ?? "string"
}

function optionFromValue(value) {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return null
  }

  return {
    value: String(value),
    label: String(value),
  }
}

function uniqueOptions(values) {
  const seen = new Set()
  const options = []

  for (const value of values) {
    const option = optionFromValue(value)

    if (!option || seen.has(option.value)) {
      continue
    }

    seen.add(option.value)
    options.push(option)
  }

  return options.length > 0 ? options : undefined
}

function cleanDescription(value) {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function getEnumOptions(schema) {
  if (Array.isArray(schema?.enum)) {
    return uniqueOptions(schema.enum)
  }

  if (Array.isArray(schema?.oneOf)) {
    const values = []

    for (const child of schema.oneOf) {
      if (Array.isArray(child?.enum)) {
        values.push(...child.enum)
      }
      if (child?.const !== undefined) {
        values.push(child.const)
      }
    }

    return uniqueOptions(values)
  }

  return undefined
}

function getModelValues(schema) {
  if (!isRecord(schema)) {
    return []
  }

  if (schema.const !== undefined) {
    const option = optionFromValue(schema.const)
    return option ? [option.value] : []
  }

  const options = getEnumOptions(schema)
  return options?.map((option) => option.value) ?? []
}

function getSuggestedOptions(schema) {
  const values = schema?.["x-recommended-values"] ?? schema?.examples

  return Array.isArray(values) ? uniqueOptions(values) : undefined
}

function getArrayEnum(schema) {
  if (inferType(schema) !== "array") {
    return undefined
  }

  const items = Array.isArray(schema.items) ? schema.items[0] : schema.items

  if (!isRecord(items)) {
    return undefined
  }

  const directOptions = getEnumOptions(items)
  if (directOptions) {
    return { options: directOptions }
  }

  return undefined
}

function isImageField(name, schema) {
  return (
    IMAGE_INPUT_FIELDS.has(name) ||
    schema?.contentEncoding === "base64" ||
    schema?.format === "binary" ||
    schema?.format === "uri" && name.includes("image")
  )
}

function isVideoField(name, schema) {
  return VIDEO_INPUT_FIELDS.has(name) || schema?.format === "uri" && name.includes("video")
}

function isAudioField(name, schema) {
  return AUDIO_INPUT_FIELDS.has(name) || schema?.format === "uri" && name.includes("audio")
}

function isMediaObject(schema) {
  if (!isRecord(schema?.properties)) {
    return false
  }

  const propertyNames = new Set(Object.keys(schema.properties))

  return (
    propertyNames.has("bytesBase64Encoded") ||
    propertyNames.has("url") ||
    propertyNames.has("uri")
  )
}

function fieldKindFromSchema(name, schema, options) {
  if (name === "prompt" || name === "text") {
    return "prompt"
  }

  if (isImageField(name, schema) || isMediaObject(schema)) {
    return "image"
  }

  if (isVideoField(name, schema) || isAudioField(name, schema)) {
    return "text"
  }

  const type = inferType(schema)

  if (type === "boolean") {
    return "boolean"
  }

  if (options?.length) {
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

function fieldNameFromPath(path) {
  return path[path.length - 1]
}

function buildField(path, schema, required) {
  if (!isRecord(schema)) {
    return null
  }

  const name = fieldNameFromPath(path)
  const description = cleanDescription(schema.description)

  if (schema.const !== undefined) {
    const value = optionFromValue(schema.const)?.value

    if (value === undefined) {
      return null
    }

    return {
      name,
      label: name,
      ...(description ? { description } : {}),
      kind: "text",
      required,
      advanced: ADVANCED_FIELDS.has(name),
      hidden: name === "model" || name.endsWith("_type"),
      constantValue: value,
      payloadPath: path,
    }
  }

  const arrayEnum = getArrayEnum(schema)
  const options = getEnumOptions(schema) ?? arrayEnum?.options
  const suggestedValues = getSuggestedOptions(schema)
  const kind = fieldKindFromSchema(name, schema, options)
  const type = inferType(schema)

  if (
    type === "object" &&
    !options &&
    !isImageField(name, schema) &&
    !isMediaObject(schema)
  ) {
    return null
  }

  if (type === "array" && !options && !isImageField(name, schema)) {
    return null
  }

  const field = {
    name,
    label: name,
    ...(description ? { description } : {}),
    kind,
    required,
    advanced: ADVANCED_FIELDS.has(name),
    hidden: name === "model",
    payloadPath: path,
  }

  if (options) {
    field.options = options
  }

  if (suggestedValues) {
    field.suggestedValues = suggestedValues
  }

  if (arrayEnum?.itemKey) {
    field.arrayItemKey = arrayEnum.itemKey
  } else if (arrayEnum) {
    field.arrayItemKey = ""
  }

  if (
    typeof schema.default === "string" ||
    typeof schema.default === "number" ||
    typeof schema.default === "boolean"
  ) {
    field.defaultValue = schema.default
  }

  if (typeof schema.minimum === "number") {
    field.min = schema.minimum
  }

  if (typeof schema.maximum === "number") {
    field.max = schema.maximum
  }

  if (typeof schema.multipleOf === "number") {
    field.multipleOf = schema.multipleOf
    field.step = schema.multipleOf
  } else if (kind === "slider" && typeof schema.minimum === "number") {
    field.step = inferType(schema) === "integer" ? 1 : 0.1
  }

  if (kind === "image") {
    field.acceptMultiple = type === "array" || name === "images"
    field.acceptUrl = true
  }

  return field
}

function fieldRank(field) {
  if (field.name === "prompt" || field.name === "text") return 0
  if (field.kind === "image") return 1
  if (field.name === "aspect_ratio" || field.name === "ratio") return 2
  if (field.name === "size" || field.name === "resolution") return 3
  if (field.name === "duration" || field.name === "seconds") return 4
  if (field.advanced) return 10
  return 5
}

function sortFields(fields) {
  return [...fields].sort((left, right) => {
    const rank = fieldRank(left) - fieldRank(right)
    return rank || left.name.localeCompare(right.name)
  })
}

function addField(fields, seen, path, schema, required) {
  const field = buildField(path, schema, required)

  if (!field) {
    return
  }

  const key = field.payloadPath.join(".")
  if (seen.has(key)) {
    return
  }

  seen.add(key)
  fields.push(field)
}

function fieldsFromRequestSchema(schema) {
  if (!isRecord(schema?.properties)) {
    return []
  }

  const rootRequired = new Set(Array.isArray(schema.required) ? schema.required : [])
  const fields = []
  const seen = new Set()

  for (const [rootName, rootSchema] of Object.entries(schema.properties)) {
    if (rootName === "input" || rootName === "parameters") {
      if (!isRecord(rootSchema?.properties)) {
        continue
      }

      const nestedRequired = new Set(
        Array.isArray(rootSchema.required) ? rootSchema.required : []
      )

      for (const [name, propertySchema] of Object.entries(rootSchema.properties)) {
        addField(
          fields,
          seen,
          [rootName, name],
          propertySchema,
          rootRequired.has(rootName) && nestedRequired.has(name)
        )
      }

      continue
    }

    addField(fields, seen, [rootName], rootSchema, rootRequired.has(rootName))
  }

  return sortFields(fields)
}

function findOperations(document) {
  const operations = []

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!isRecord(operation) || !operation.operationId) {
        continue
      }

      operations.push({ path, method, operation })
    }
  }

  return operations
}

function firstRequestContent(operation) {
  const content = operation.requestBody?.content

  if (!isRecord(content)) {
    return null
  }

  return {
    contentType: content["application/json"]
      ? "application/json"
      : content["multipart/form-data"]
        ? "multipart/form-data"
        : Object.keys(content)[0] ?? "application/json",
    body:
      content["application/json"] ??
      content["multipart/form-data"] ??
      Object.values(content)[0] ??
      null,
  }
}

function generateTypeDefinitions(inputFile, outputFile) {
  execFileSync(openapiTypescriptBin, [inputFile, "-o", outputFile], {
    cwd: root,
    stdio: "inherit",
  })
}

async function generateMetadataForSpec(inputFile) {
  const document = await dereference(inputFile, {
    dereference: {
      circular: "ignore",
    },
  })
  const projectFile = toProjectPath(inputFile)
  const title = cleanDescription(document.info?.title)?.replace(/接口文档$/, "")
  const records = []
  const models = []

  for (const { path, method, operation } of findOperations(document)) {
    const requestContent = firstRequestContent(operation)
    const schema = requestContent?.body?.schema

    if (!schema) {
      continue
    }

    const key = `${projectFile}#${operation.operationId}`
    const fields = fieldsFromRequestSchema(schema)
    records.push([key, fields])

    if (
      method.toLowerCase() === "post" &&
      path === "/v1/tasks/submit" &&
      requestContent.contentType === "application/json" &&
      isRecord(schema.properties)
    ) {
      const modelValues = getModelValues(schema.properties.model)
      models.push({
        file: projectFile,
        title: title ?? basename(inputFile, ".yaml"),
        operationId: operation.operationId,
        method: "POST",
        path,
        statusPath: "/v1/tasks/status",
        contentType: "application/json",
        adapter: "async-task",
        modelValues,
      })
    }
  }

  return { records, models }
}

function writeMetadata(records, models) {
  const sortedRecords = [...records].sort(([left], [right]) =>
    left.localeCompare(right)
  )
  const sortedModels = [...models].sort((left, right) =>
    `${left.file}#${left.operationId}`.localeCompare(
      `${right.file}#${right.operationId}`
    )
  )
  const fieldsBody = JSON.stringify(Object.fromEntries(sortedRecords), null, 2)
  const modelsBody = JSON.stringify(sortedModels, null, 2)

  writeFileSync(
    metadataFile,
    `// This file is generated by scripts/generate-video-openapi.mjs.\n` +
      `// Do not edit by hand. Run \`bun run codegen:video-openapi\`.\n\n` +
      `import type { StudioVideoOpenapiModelEntry, StudioVideoParameterField } from "@/lib/studio-video-types"\n\n` +
      `export const VIDEO_OPENAPI_FIELDS = ${fieldsBody} satisfies Record<string, StudioVideoParameterField[]>\n\n` +
      `export const VIDEO_OPENAPI_MODELS = ${modelsBody} satisfies StudioVideoOpenapiModelEntry[]\n`,
    "utf8"
  )
}

async function main() {
  if (!existsSync(openapiTypescriptBin)) {
    throw new Error("openapi-typescript is not installed.")
  }

  mkdirSync(generatedTypesDir, { recursive: true })

  if (existsSync(metadataFile)) {
    rmSync(metadataFile)
  }

  const openapiFiles = readdirSync(openapiDir)
    .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
    .sort()
    .map((file) => join(openapiDir, file))
  const metadataRecords = []
  const modelRecords = []

  for (const inputFile of openapiFiles) {
    const typeOutputFile = join(
      generatedTypesDir,
      `${toGeneratedTypeName(inputFile)}.d.ts`
    )

    generateTypeDefinitions(inputFile, typeOutputFile)
    const metadata = await generateMetadataForSpec(inputFile)
    metadataRecords.push(...metadata.records)
    modelRecords.push(...metadata.models)
  }

  writeMetadata(metadataRecords, modelRecords)
  console.log(
    `Generated ${openapiFiles.length} OpenAPI type files, ${metadataRecords.length} field metadata entries, and ${modelRecords.length} model entries.`
  )
}

await main()
