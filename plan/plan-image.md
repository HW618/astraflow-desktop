# Image Studio Plan

## Scope

Build the Studio image mode as a desktop workbench:

- Left Card: model select, prompt, OpenAPI-derived parameters, generate action.
- Right canvas: generated images, request history, download/save actions.
- One image session can contain multiple prompts and multiple generation requests.
- Every generation request is persisted with model, prompt, parameters, status, outputs, and raw response metadata.
- Clicking a generated image loads the original model, prompt, and parameters back into the left Card.
- Frontend copy stays functional only: labels, placeholders, statuses, validation, buttons. No feature descriptions, onboarding text, repeated page titles, or explanatory paragraphs.

## Model Source

Studio image mode must use the existing Explore model interface as the model source of truth:

```text
GET /api/model-square?outputType=image&limit=all&contextLength=all&orderBy=Name&order=Asc
```

Use the returned `SquareModel[]` fields:

- `Id`
- `Name`
- `ChineseName`
- `Manufacturer`
- `InputModalities`
- `OutputModalities`
- `CoverUrl`
- `Pricing`
- `Tiers`

Do not hard-code the image model list in the frontend. The frontend should fetch this API, then keep only models that also have an OpenAPI parameter spec or an explicit adapter status.

Current Explore result from local route handler: 25 image-output models.

| Model name | OpenAPI source | Initial status |
| --- | --- | --- |
| `doubao-seedream-4.5` | `openapi/image/doubao-seedream.yaml` | supported |
| `doubao-seedream-5-0-260128` | `openapi/image/doubao-seedream.yaml` | supported |
| `flux-2-pro` | `openapi/image/flux-2-pro.yaml` | supported |
| `flux-kontext-pro` | missing | hidden/disabled until spec exists |
| `flux-pro-1.1` | missing | hidden/disabled until spec exists |
| `gemini-2.5-flash-image` | `openapi/image/gemini-2.5-flash-image.yaml` | supported with Gemini adapter |
| `gemini-3.1-flash-image` | `openapi/image/gemini-3.1-flash-image.yaml` | alias check required |
| `gemini-3.1-flash-image-preview` | `openapi/image/gemini-3.1-flash-image.yaml` | supported with Gemini adapter |
| `Qwen/Qwen-Image` | `openapi/image/Qwen-Qwen-Image.yaml` | supported |
| `Qwen/Qwen-Image-Edit` | `openapi/image/Qwen-Qwen-Image-Edit.yaml` | edit-only, require image input |
| `stepfun-ai/step1x-edit` | `openapi/image/stepfun-ai-step1x-edit.yaml` | edit-only, require image input |
| `wan2.7-image` | `openapi/image/Wan-AI-Wan2.7-Image.yaml` | supported |
| `wan2.7-image-pro` | `openapi/image/Wan-AI-Wan2.7-Image.yaml` | supported |
| `gemini-3-pro-image` | `openapi/image/gemini-3-pro-image.yaml` | alias check required |
| `gemini-3-pro-image-preview` | `openapi/image/gemini-3-pro-image.yaml` | supported with Gemini adapter |
| `gpt-image-1` | missing | hidden/disabled until spec exists |
| `gpt-image-1-mini` | missing | hidden/disabled until spec exists |
| `gpt-image-1.5` | missing | hidden/disabled until spec exists |
| `gpt-image-2` | `openapi/image/gpt-image-2.yaml` | supported |
| `midjourney-fast-imagine` | `openapi/image/midjourney.yaml` | async task adapter |
| `midjourney-fast-reroll` | `openapi/image/midjourney.yaml` | follow-up action, hide from first-pass text-to-image |
| `midjourney-fast-upscale` | `openapi/image/midjourney.yaml` | follow-up action, hide from first-pass text-to-image |
| `midjourney-fast-variation` | `openapi/image/midjourney.yaml` | follow-up action, hide from first-pass text-to-image |
| `mimo-v2.5` | missing | hidden/disabled until spec exists |
| `publishers/google/models/gemini-3-pro-image-preview` | `openapi/image/gemini-3-pro-image.yaml` | normalize publisher prefix |

## OpenAPI Parameter Loading

Add a server-side parameter loader. The browser should not read YAML files directly.

Proposed files:

- `lib/image-model-openapi.ts`: registry that maps normalized model names to OpenAPI file, operation, endpoint style, and support status.
- `lib/image-openapi.ts`: YAML parsing, `$ref` resolution, request schema extraction, and conversion into Studio field definitions.
- `app/api/studio/image/models/route.ts`: returns Explore image models merged with OpenAPI parameter specs.

Direct dependency to add when implementing: `js-yaml`, because it is currently only transitive in `bun.lock`.

Returned shape:

```ts
type StudioImageModelOption = {
  id: string
  name: string
  label: string
  manufacturer: string
  inputModalities: string[]
  outputModalities: string[]
  supported: boolean
  disabledReason?: "missing-openapi" | "alias-unverified" | "follow-up-only"
  openapi?: {
    file: string
    operationId: string
    method: "POST" | "GET"
    path: string
    contentType: "application/json" | "multipart/form-data"
    adapter: "openai-images" | "gemini-generate-content" | "custom-json" | "async-task"
  }
  fields: StudioImageParameterField[]
}
```

Parameter extraction rules:

- Resolve `requestBody.content` for the chosen operation.
- Resolve nested `$ref` schemas.
- Keep `model` constants hidden but include them in submitted payloads.
- Render `prompt` as the primary textarea.
- Render `enum` as `Select`.
- Render boolean as toggle.
- Render bounded number/integer as slider plus compact numeric input.
- Render unbounded number/integer as compact numeric input.
- Render image URL/base64 fields as file input plus optional URL input when schema allows string input.
- Keep advanced fields collapsed by default, with only the label `Advanced`.
- Do not render OpenAPI descriptions as frontend helper text.

Adapter-specific flattening:

- OpenAI-compatible `/v1/images/generations`: send extracted JSON fields directly.
- `gpt-image-2` `/v1/images/edits`: use multipart only when image input is present.
- Gemini `generateContent`: expose prompt, aspect ratio, image size, and search/tool toggle; transform form state into `contents` and `generationConfig`.
- Midjourney `/v1/tasks/submit`: first pass supports `midjourney-fast-imagine`; follow-up actions load only from completed task buttons later.
- Wan async task routes can be added after synchronous `/v1/images/generations` works.

## Data Model

Keep chat messages separate from image generations. Add image-specific tables.

```sql
CREATE TABLE IF NOT EXISTS studio_image_generations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  model_square_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  manufacturer TEXT,
  openapi_file TEXT,
  operation_id TEXT,
  prompt TEXT NOT NULL,
  params TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  raw_response TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (session_id) REFERENCES studio_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS studio_image_outputs (
  id TEXT PRIMARY KEY,
  generation_id TEXT NOT NULL,
  output_index INTEGER NOT NULL,
  url TEXT,
  data_url TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  metadata TEXT,
  saved_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (generation_id) REFERENCES studio_image_generations(id) ON DELETE CASCADE
);
```

Indexes:

- `studio_image_generations(session_id, created_at ASC)`
- `studio_image_outputs(generation_id, output_index ASC)`

Status values:

- `queued`
- `running`
- `complete`
- `partial`
- `error`

For URL-only model responses, persist the URL immediately and store expiry-sensitive metadata. The Save action should fetch the remote URL server-side and persist `data_url` when possible, so saved images survive short-lived provider links.

## API Plan

Use App Router route handlers with `runtime = "nodejs"`.

Routes:

- `GET /api/studio/image/models`
  - Calls/reuses Explore model-square logic with `outputType=image&limit=all`.
  - Merges OpenAPI field specs.
  - Returns supported and disabled image model options.
- `GET /api/studio/sessions/[sessionId]/image-generations`
  - Lists persisted image generation records and outputs for a session.
- `POST /api/studio/sessions/[sessionId]/image-generations`
  - Validates session is `image`.
  - Validates model is present in Explore image models.
  - Validates submitted params against the extracted OpenAPI/Zod schema.
  - Creates a `running` generation record.
  - Calls ModelVerse.
  - Stores normalized outputs and raw response metadata.
  - Updates `studio_sessions.updated_at`.
- `POST /api/studio/image-outputs/[outputId]/save`
  - Pins URL-only output as local `data_url`.
  - Sets `saved_at`.

Existing route reuse:

- Session creation should continue using `POST /api/studio/sessions` with `mode: "image"`.
- If the user generates without an active session, create an image session using the first prompt as title fallback, then submit the generation.
- Existing session rename/delete can remain unchanged.

## UI Plan

Add `components/studio-image-workbench.tsx` and render it from `StudioShell` when `activeMode === "image"`.

Layout:

- Shell wrapper: `flex min-h-0 flex-1 overflow-hidden`.
- Left Card: fixed desktop width around `340-380px`, `shrink-0`, internal scroll if fields exceed height.
- Right pane: `min-h-0 flex-1 overflow-y-auto`.
- Result grid: natural-height flex/grid inside the scroll pane, with cards `shrink-0`.

Left Card controls:

- Model select.
- Prompt textarea.
- Dynamic fields from OpenAPI.
- Reference image inputs only when selected model exposes image fields.
- Generate button.
- Stop/cancel button only if the adapter supports aborting or async polling cancellation.

Right pane:

- Generation groups sorted newest last or newest first; keep one choice consistent.
- Each group shows prompt, model, compact status, and image outputs.
- Each output has image preview, download, save, and select actions.
- Clicking the image preview selects that output and loads its generation params into the left Card.
- Empty state: no explanatory text; use a subtle empty canvas or a short label like `No images`.

Copy rules:

- Allowed: `Model`, `Prompt`, `Size`, `Seed`, `Quality`, `Generate`, `Download`, `Save`, `Saved`, `Failed`, `Running`, counts, validation errors.
- Avoid: feature descriptions, onboarding copy, “how to use” paragraphs, marketing-style headings, repeated route title, long helper text from OpenAPI descriptions.

## Request Flow

1. User opens Image mode.
2. Client fetches `GET /api/studio/image/models`.
3. Client selects the first supported model or the last local selection if still supported.
4. Parameter panel renders from `fields`.
5. User submits prompt and params.
6. If no session exists, client creates `mode: "image"` session.
7. Client posts generation request to the active session.
8. Server records request before provider call.
9. Server normalizes provider response into `studio_image_outputs`.
10. Client reloads generation list.
11. User clicks an image; client loads generation params into the form.

## Normalized Output Handling

Supported provider output forms:

- `data[].b64_json`
- `data[].url`
- Gemini `candidates[].content.parts[].inlineData`
- Async task `output.urls`

Normalization:

```ts
type StudioImageOutput = {
  id: string
  generationId: string
  index: number
  src: string
  url: string | null
  dataUrl: string | null
  mimeType: string | null
  width: number | null
  height: number | null
  savedAt: string | null
  createdAt: string
}
```

`src` should prefer `dataUrl`, then `url`.

## Implementation Order

1. Extract or wrap Explore image-model fetching for Studio.
2. Add model-to-OpenAPI registry and parameter loader.
3. Add image generation/output types to `lib/studio-types.ts`.
4. Add SQLite migration and DB helpers in `lib/studio-db.ts`.
5. Add image models, generation list, generation submit, and output save routes.
6. Add `StudioImageWorkbench`.
7. Wire `StudioShell` image mode to the new workbench.
8. Add i18n keys for functional labels only.
9. Verify with `bun run lint` and `bun run typecheck`.

## First Pass Support Boundary

First pass:

- Text-to-image for supported synchronous models.
- OpenAPI-derived parameters.
- Persisted request history.
- Click image to load params.
- Download and Save.

Second pass:

- Image editing workflows that require source images.
- Midjourney follow-up buttons.
- Async polling UX for Midjourney and Wan task routes.
- Missing OpenAPI specs for `gpt-image-1`, `gpt-image-1-mini`, `gpt-image-1.5`, `flux-kontext-pro`, `flux-pro-1.1`, and `mimo-v2.5`.

## Verification

Default verification:

```bash
bun run lint
bun run typecheck
```

Do not run `bun run build` and do not start the dev server unless explicitly requested.
