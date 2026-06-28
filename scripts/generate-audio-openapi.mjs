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
const openapiDir = join(root, "openapi/audio")
const generatedDir = join(root, "lib/generated")
const generatedTypesDir = join(generatedDir, "openapi/audio")
const metadataFile = join(generatedDir, "audio-openapi-fields.ts")
const openapiTypescriptBin = join(
  root,
  "node_modules/.bin/openapi-typescript"
)

const ADVANCED_FIELDS = new Set([
  "seed",
  "output_format",
  "response_format",
  "stream",
  "stream_options",
  "subtitle_enable",
  "aigc_watermark",
  "pronunciation_dict",
  "timber_weights",
  "voice_modify",
  "emo_vec",
  "emo_weight",
  "emo_alpha",
  "emo_random",
  "interval_silence",
  "max_text_tokens_per_sentence",
])

const PROMPT_FIELDS = new Set([
  "input",
  "prompt",
  "text",
  "gpt_description_prompt",
])

const SKIPPED_OPERATION_PATTERNS = [
  /transcribe/i,
  /upload/i,
  /list/i,
  /delete/i,
  /plan/i,
  /stream/i,
]

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

function schemaVariants(schema) {
  if (!isRecord(schema)) {
    return []
  }

  const variants = [schema]

  for (const key of ["oneOf", "anyOf", "allOf"]) {
    if (!Array.isArray(schema[key])) {
      continue
    }

    for (const child of schema[key]) {
      variants.push(...schemaVariants(child))
    }
  }

  return variants
}

function firstObjectProperties(schema) {
  for (const variant of schemaVariants(schema)) {
    if (isRecord(variant.properties)) {
      return variant.properties
    }
  }

  return null
}

function collectPropertyEntries(schema) {
  const entries = []
  const seen = new Set()

  for (const variant of schemaVariants(schema)) {
    if (!isRecord(variant.properties)) {
      continue
    }

    const required = new Set(
      Array.isArray(variant.required) ? variant.required : []
    )

    for (const [name, propertySchema] of Object.entries(variant.properties)) {
      if (seen.has(name)) {
        continue
      }

      seen.add(name)
      entries.push({ name, schema: propertySchema, required: required.has(name) })
    }
  }

  return entries
}

function optionFromValue(value) {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return null
  }

  return { value: String(value), label: String(value) }
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

  const values = []

  for (const variant of schemaVariants(schema)) {
    if (Array.isArray(variant.enum)) {
      values.push(...variant.enum)
    }
    if (variant.const !== undefined) {
      values.push(variant.const)
    }
  }

  return uniqueOptions(values)
}

function getModelValues(schema) {
  const values = []

  for (const variant of schemaVariants(schema)) {
    if (variant.const !== undefined) {
      values.push(variant.const)
    }
    if (Array.isArray(variant.enum)) {
      values.push(...variant.enum)
    }
    if (Array.isArray(variant.examples)) {
      values.push(...variant.examples)
    }
  }

  return uniqueOptions(values)?.map((option) => option.value) ?? []
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

  const options = getEnumOptions(items)
  return options ? { options } : undefined
}

function fieldNameFromPath(path) {
  return path[path.length - 1]
}

function isAudioUploadField(name, schema) {
  return (
    schema?.format === "binary" &&
    (name.includes("audio") || name.includes("file"))
  )
}

function fieldKindFromSchema(name, schema, options) {
  if (PROMPT_FIELDS.has(name)) {
    return "prompt"
  }

  if (isAudioUploadField(name, schema)) {
    return "audio"
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

  if (type === "array" || type === "object") {
    return "textarea"
  }

  return "text"
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
      label: path.join("."),
      ...(description ? { description } : {}),
      kind: "text",
      required,
      advanced: ADVANCED_FIELDS.has(name),
      hidden: true,
      constantValue: value,
      payloadPath: path,
    }
  }

  const arrayEnum = getArrayEnum(schema)
  const options = getEnumOptions(schema) ?? arrayEnum?.options
  const suggestedValues = getSuggestedOptions(schema)
  const kind = fieldKindFromSchema(name, schema, options)
  const type = inferType(schema)

  if (type === "object" && !options && !firstObjectProperties(schema)) {
    return null
  }

  const field = {
    name,
    label: path.join("."),
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

  if (arrayEnum) {
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

  if (kind === "audio") {
    field.mediaKind = "audio"
    field.mediaShape = "multipart-binary"
  }

  if (schema.contentMediaType) {
    field.contentMediaType = schema.contentMediaType
  }

  return field
}

function fieldRank(field) {
  if (field.kind === "prompt") {
    if (field.name === "input" || field.name === "prompt") return 0
    return 1
  }
  if (field.kind === "audio") return 2
  if (field.name === "voice" || field.name === "voice_id") return 2
  if (field.name === "duration_seconds" || field.name === "music_length_ms") {
    return 3
  }
  if (field.advanced) return 10
  return 5
}

function sortFields(fields) {
  return [...fields].sort((left, right) => {
    const rank = fieldRank(left) - fieldRank(right)
    return rank || left.payloadPath.join(".").localeCompare(right.payloadPath.join("."))
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

function addFieldsFromSchema(fields, seen, path, schema, required, depth = 0) {
  const properties = firstObjectProperties(schema)

  if (properties && depth < 2 && fieldNameFromPath(path) !== "composition_plan") {
    const requiredNames = new Set(
      schemaVariants(schema).flatMap((variant) =>
        Array.isArray(variant.required) ? variant.required : []
      )
    )

    for (const [name, propertySchema] of Object.entries(properties)) {
      addFieldsFromSchema(
        fields,
        seen,
        [...path, name],
        propertySchema,
        required && requiredNames.has(name),
        depth + 1
      )
    }

    return
  }

  addField(fields, seen, path, schema, required)
}

function fieldsFromRequestSchema(schema) {
  const rootRequired = new Set(Array.isArray(schema?.required) ? schema.required : [])
  const fields = []
  const seen = new Set()

  for (const entry of collectPropertyEntries(schema)) {
    addFieldsFromSchema(
      fields,
      seen,
      [entry.name],
      entry.schema,
      rootRequired.has(entry.name) || entry.required
    )
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

function responseContentTypes(operation) {
  const content = operation.responses?.["200"]?.content

  return isRecord(content) ? Object.keys(content) : []
}

function getResponseKind(operation, path) {
  if (path === "/v1/tasks/submit") {
    return "async"
  }

  const contentTypes = responseContentTypes(operation)

  if (
    contentTypes.some(
      (type) =>
        type.startsWith("audio/") ||
        type === "application/octet-stream" ||
        type.startsWith("multipart/")
    )
  ) {
    return "binary"
  }

  return "json"
}

function getAdapter(contentType, responseKind) {
  if (responseKind === "async") {
    return "async-task"
  }

  if (contentType === "multipart/form-data") {
    return "audio-multipart"
  }

  return responseKind === "binary" ? "audio-binary" : "audio-json"
}

function shouldIncludeOperation(operation, path) {
  if (SKIPPED_OPERATION_PATTERNS.some((pattern) => pattern.test(operation.operationId))) {
    return false
  }

  if (path === "/v1/tasks/submit") {
    return true
  }

  const kinds = responseContentTypes(operation)

  return kinds.some(
    (type) =>
      type.startsWith("audio/") ||
      type === "application/octet-stream" ||
      type.startsWith("multipart/") ||
      type === "application/json"
  )
}

function generateTypeDefinitions(inputFile, outputFile) {
  execFileSync(openapiTypescriptBin, [inputFile, "-o", outputFile], {
    cwd: root,
    stdio: "inherit",
  })
}

async function generateMetadataForSpec(inputFile) {
  const document = await dereference(inputFile, {
    dereference: { circular: "ignore" },
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
      method.toLowerCase() !== "post" ||
      !shouldIncludeOperation(operation, path)
    ) {
      continue
    }

    const modelField = fields.find((field) => field.name === "model")
    const modelSchema = modelField
      ? schemaVariants(schema).find((variant) =>
          isRecord(variant.properties?.model)
        )?.properties?.model
      : undefined
    const modelValues =
      (modelSchema ? getModelValues(modelSchema) : []) ??
      fields
        .find((field) => field.name === "model")
        ?.options?.map((option) => option.value) ??
      []

    if (modelValues.length === 0) {
      continue
    }

    const responseKind = getResponseKind(operation, path)
    const statusPath = path === "/v1/tasks/submit" ? "/v1/tasks/status" : undefined

    models.push({
      file: projectFile,
      title: title ?? basename(inputFile, ".yaml"),
      operationId: operation.operationId,
      method: "POST",
      path,
      ...(statusPath ? { statusPath } : {}),
      contentType: requestContent.contentType,
      adapter: getAdapter(requestContent.contentType, responseKind),
      responseKind,
      modelValues,
    })
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
    `// This file is generated by scripts/generate-audio-openapi.mjs.\n` +
      `// Do not edit by hand. Run \`bun run codegen:audio-openapi\`.\n\n` +
      `import type { StudioAudioOpenapiModelEntry, StudioAudioParameterField } from "@/lib/studio-audio-types"\n\n` +
      `export const AUDIO_OPENAPI_FIELDS = ${fieldsBody} satisfies Record<string, StudioAudioParameterField[]>\n\n` +
      `export const AUDIO_OPENAPI_MODELS = ${modelsBody} satisfies StudioAudioOpenapiModelEntry[]\n`,
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
    `Generated ${openapiFiles.length} audio OpenAPI type files, ${metadataRecords.length} field metadata entries, and ${modelRecords.length} model entries.`
  )
}

await main()
