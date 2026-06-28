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
const openapiDir = join(root, "openapi/image")
const generatedDir = join(root, "lib/generated")
const generatedTypesDir = join(generatedDir, "openapi/image")
const metadataFile = join(generatedDir, "image-openapi-fields.ts")
const openapiTypescriptBin = join(
  root,
  "node_modules/.bin/openapi-typescript"
)

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
    }

    return uniqueOptions(values)
  }

  return undefined
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

  if (inferType(items) === "object" && isRecord(items.properties)) {
    const entries = Object.entries(items.properties)

    if (entries.length === 1) {
      const [[itemKey, propertySchema]] = entries

      if (propertySchema.const !== undefined) {
        const option = optionFromValue(propertySchema.const)
        return option ? { itemKey, options: [option] } : undefined
      }

      const nestedOptions = getEnumOptions(propertySchema)
      if (nestedOptions) {
        return { itemKey, options: nestedOptions }
      }
    }
  }

  return undefined
}

function isImageField(name, schema) {
  return (
    IMAGE_INPUT_FIELDS.has(name) ||
    schema?.contentEncoding === "base64" ||
    schema?.format === "binary"
  )
}

function fieldKindFromSchema(name, schema, options) {
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

function buildField(name, schema, required) {
  if (!isRecord(schema)) {
    return null
  }

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
      advanced: false,
      hidden: true,
      constantValue: value,
    }
  }

  const arrayEnum = getArrayEnum(schema)
  const options = getEnumOptions(schema) ?? arrayEnum?.options
  const suggestedValues = getSuggestedOptions(schema)
  const kind = fieldKindFromSchema(name, schema, options)

  if (inferType(schema) === "object" && !options && !isImageField(name, schema)) {
    return null
  }

  const field = {
    name,
    label: name,
    ...(description ? { description } : {}),
    kind,
    required,
    advanced: ADVANCED_FIELDS.has(name),
    hidden: false,
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
    const type = inferType(schema)
    field.acceptMultiple = type === "array" || name === "images" || name === "image[]"
    field.acceptUrl =
      type === "string" ||
      name === "images" ||
      name === "image" ||
      name.startsWith("input_image")
  }

  return field
}

function fieldRank(field) {
  if (field.name === "prompt") return 0
  if (field.kind === "image") return 1
  if (field.name === "size") return 2
  if (field.name === "n") return 3
  if (field.advanced) return 10
  return 5
}

function sortFields(fields) {
  return [...fields].sort((left, right) => {
    const rank = fieldRank(left) - fieldRank(right)
    return rank || left.name.localeCompare(right.name)
  })
}

function fieldsFromSchema(schema) {
  if (!isRecord(schema?.properties)) {
    return []
  }

  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  const fields = []

  for (const [name, propertySchema] of Object.entries(schema.properties)) {
    const field = buildField(name, propertySchema, required.has(name))

    if (field) {
      fields.push(field)
    }
  }

  return sortFields(fields)
}

function getDiscriminatorValue(parentSchema, schema) {
  const propertyName = parentSchema?.discriminator?.propertyName

  if (!propertyName || !isRecord(schema?.properties)) {
    return null
  }

  const discriminatorSchema = schema.properties[propertyName]

  if (discriminatorSchema?.const !== undefined) {
    return optionFromValue(discriminatorSchema.const)?.value ?? null
  }

  if (
    Array.isArray(discriminatorSchema?.enum) &&
    discriminatorSchema.enum.length === 1
  ) {
    return optionFromValue(discriminatorSchema.enum[0])?.value ?? null
  }

  return null
}

function schemaVariants(schema) {
  const variants = []
  const unionSchemas = Array.isArray(schema?.oneOf) ? schema.oneOf : null

  if (!unionSchemas) {
    return [{ keySuffix: "", schema }]
  }

  for (const child of unionSchemas) {
    const discriminatorValue = getDiscriminatorValue(schema, child)

    variants.push({
      keySuffix: discriminatorValue ? `:${discriminatorValue}` : "",
      schema: child,
    })
  }

  return variants
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

  return (
    content["application/json"] ??
    content["multipart/form-data"] ??
    Object.values(content)[0] ??
    null
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
    dereference: {
      circular: "ignore",
    },
  })
  const projectFile = toProjectPath(inputFile)
  const records = []

  for (const { operation } of findOperations(document)) {
    const requestContent = firstRequestContent(operation)
    const schema = requestContent?.schema

    if (!schema) {
      continue
    }

    for (const variant of schemaVariants(schema)) {
      const key = `${projectFile}#${operation.operationId}${variant.keySuffix}`
      const fields = fieldsFromSchema(variant.schema)

      records.push([key, fields])
    }
  }

  return records
}

function writeMetadata(records) {
  const sorted = [...records].sort(([left], [right]) => left.localeCompare(right))
  const body = JSON.stringify(Object.fromEntries(sorted), null, 2)

  writeFileSync(
    metadataFile,
    `// This file is generated by scripts/generate-image-openapi.mjs.\n` +
      `// Do not edit by hand. Run \`bun run codegen:image-openapi\`.\n\n` +
      `import type { StudioImageParameterField } from "@/lib/studio-types"\n\n` +
      `export const IMAGE_OPENAPI_FIELDS = ${body} satisfies Record<string, StudioImageParameterField[]>\n`,
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

  for (const inputFile of openapiFiles) {
    const typeOutputFile = join(
      generatedTypesDir,
      `${toGeneratedTypeName(inputFile)}.d.ts`
    )

    generateTypeDefinitions(inputFile, typeOutputFile)
    metadataRecords.push(...(await generateMetadataForSpec(inputFile)))
  }

  writeMetadata(metadataRecords)
  console.log(
    `Generated ${openapiFiles.length} OpenAPI type files and ${metadataRecords.length} field metadata entries.`
  )
}

await main()
