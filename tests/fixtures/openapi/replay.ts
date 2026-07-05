import assert from "node:assert/strict"

import { IMAGE_OPENAPI_FIELDS } from "@/lib/generated/image-openapi-fields"
import {
  VIDEO_OPENAPI_FIELDS,
  VIDEO_OPENAPI_MODELS,
} from "@/lib/generated/video-openapi-fields"
import {
  createListStudioImageModelsTool,
  createListStudioVideoModelsTool,
} from "@/lib/ai/tools/media-generation"

const seedreamKey =
  "openapi/image/doubao-seedream.yaml#createDoubaoSeedreamImageGeneration"
const seedanceKey =
  "openapi/video/doubao-seedance-1-5-pro-251215.yaml#submitDoubaoSeedance15Pro251215Task"

const seedreamFields = IMAGE_OPENAPI_FIELDS[seedreamKey]
const seedanceFields = VIDEO_OPENAPI_FIELDS[seedanceKey]

assert.ok(seedreamFields, "Seedream 4.5 image OpenAPI fields are generated")
assert.ok(seedanceFields, "Seedance 1.5 Pro video OpenAPI fields are generated")

const seedreamPrompt = seedreamFields.find((field) => field.name === "prompt")
const seedreamModel = seedreamFields.find((field) => field.name === "model")

assert.equal(seedreamPrompt?.kind, "prompt")
assert.equal(seedreamPrompt?.required, true)
assert.ok(
  seedreamModel?.options?.some(
    (option) => option.value === "doubao-seedream-4.5"
  ),
  "Seedream model field includes doubao-seedream-4.5"
)

const seedanceModel = seedanceFields.find((field) => field.name === "model")
const seedanceResolution = seedanceFields.find(
  (field) => field.name === "resolution"
)
const seedanceDuration = seedanceFields.find(
  (field) => field.name === "duration"
)
const seedanceModelEntry = VIDEO_OPENAPI_MODELS.find(
  (model) =>
    model.file === "openapi/video/doubao-seedance-1-5-pro-251215.yaml" &&
    model.operationId === "submitDoubaoSeedance15Pro251215Task"
)

assert.equal(seedanceModel?.required, true)
assert.deepEqual(seedanceModel?.payloadPath, ["model"])
assert.equal(seedanceResolution?.defaultValue, "720p")
assert.equal(seedanceDuration?.defaultValue, 5)
assert.ok(
  seedanceModelEntry?.modelValues.includes("doubao-seedance-1-5-pro-251215"),
  "Seedance model registry includes doubao-seedance-1-5-pro-251215"
)

const imageModelsTool = createListStudioImageModelsTool()
const videoModelsTool = createListStudioVideoModelsTool()

assert.equal(imageModelsTool.name, "studio_list_image_models")
assert.equal(videoModelsTool.name, "studio_list_video_models")

const imageModelsOutput = JSON.parse(
  String(await imageModelsTool.invoke({ query: "seedream", maxResults: 10 }))
) as { models?: Array<{ modelName?: string }> }
const videoModelsOutput = JSON.parse(
  String(await videoModelsTool.invoke({ query: "seedance", maxResults: 10 }))
) as { models?: Array<{ modelNames?: string[] }> }

assert.ok(
  imageModelsOutput.models?.some(
    (model) => model.modelName === "doubao-seedream-4.5"
  ),
  "Image model alias lists Seedream 4.5"
)
assert.ok(
  videoModelsOutput.models?.some((model) =>
    model.modelNames?.includes("doubao-seedance-1-5-pro-251215")
  ),
  "Video model alias lists Seedance 1.5 Pro"
)
