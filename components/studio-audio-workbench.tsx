"use client"

import * as React from "react"
import {
  RiAddLine,
  RiCloseLine,
  RiDownloadLine,
  RiLoader4Line,
  RiQuestionLine,
  RiSaveLine,
} from "@remixicon/react"

import {
  AudioPlayer,
  AudioPlayerControlBar,
  AudioPlayerDurationDisplay,
  AudioPlayerElement,
  AudioPlayerMuteButton,
  AudioPlayerPlayButton,
  AudioPlayerSeekBackwardButton,
  AudioPlayerSeekForwardButton,
  AudioPlayerTimeDisplay,
  AudioPlayerTimeRange,
  AudioPlayerVolumeRange,
} from "@/components/ai-elements/audio-player"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { Toggle } from "@/components/ui/toggle"
import {
  fetchStudioModelsWithCache,
  getPreferredStudioModelId,
  saveSelectedStudioModel,
} from "@/lib/studio-model-cache"
import { UCLOUD_PROJECT_CHANGED_EVENT } from "@/lib/project-selection"
import { cn, createClientId } from "@/lib/utils"
import type {
  StudioAudioGeneration,
  StudioAudioModelOption,
  StudioAudioOutput,
  StudioAudioParameterField,
} from "@/lib/studio-audio-types"
import type { StudioSession } from "@/lib/studio-types"

type StudioAudioWorkbenchProps = {
  sessionId: string
  onSessionChange: (sessionId: string) => void
  onSessionsChange: () => void
}

type ApiOk<T> = { ok: true; data: T }
type ApiErr = { ok: false; error?: unknown; message?: string }
type ApiResponse<T> = ApiOk<T> | ApiErr

type PendingAudioAttachment = {
  id: string
  name: string
  mimeType: string
  dataUrl: string
}

const MAX_AUDIO_BYTES = 24 * 1024 * 1024
const AUDIO_FALLBACK_TITLE = "New audio"

function getAudioCopy(locale: string) {
  if (locale === "zh") {
    return {
      model: "模型",
      operation: "模式",
      operationPlaceholder: "选择模式",
      modelPlaceholder: "选择模型",
      modelsLoading: "正在加载模型...",
      modelsFailed: "加载音频模型失败。",
      prompt: "文本",
      promptPlaceholder: "输入要合成的文本、歌词或声音描述",
      references: "参考音频",
      attach: "添加音频",
      advanced: "高级选项",
      advancedHide: "收起高级选项",
      generate: "生成",
      submitFailed: "生成失败。",
      empty: "暂无音频",
      download: "下载",
      save: "保存",
      saved: "已保存",
      running: "生成中",
      complete: "已完成",
      failed: "失败",
    }
  }

  return {
    model: "Model",
    operation: "Mode",
    operationPlaceholder: "Select a mode",
    modelPlaceholder: "Select a model",
    modelsLoading: "Loading models...",
    modelsFailed: "Failed to load audio models.",
    prompt: "Text",
    promptPlaceholder: "Write speech text, lyrics, or a sound description",
    references: "Reference audio",
    attach: "Add audio",
    advanced: "Advanced",
    advancedHide: "Hide advanced",
    generate: "Generate",
    submitFailed: "Failed to generate.",
    empty: "No audio",
    download: "Download",
    save: "Save",
    saved: "Saved",
    running: "Running",
    complete: "Complete",
    failed: "Failed",
  }
}

function isOk<T>(payload: ApiResponse<T>): payload is ApiOk<T> {
  return payload.ok === true
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiResponse<T>

  if (!response.ok || !isOk(payload)) {
    const message =
      (!isOk(payload) &&
        (payload.message ||
          (typeof payload.error === "string" ? payload.error : ""))) ||
      `Request failed (${response.status})`
    throw new Error(message)
  }

  return payload.data
}

async function fetchAudioModels() {
  const response = await fetch("/api/studio/audio/models")
  return readJson<{
    supported: StudioAudioModelOption[]
    disabled: StudioAudioModelOption[]
  }>(response)
}

async function fetchAudioGenerations(sessionId: string) {
  const response = await fetch(
    `/api/studio/sessions/${sessionId}/audio-generations`
  )
  return readJson<StudioAudioGeneration[]>(response)
}

function getFallbackAudioTitle(prompt: string) {
  const normalized = prompt.trim()
  return normalized ? normalized.slice(0, 120) : AUDIO_FALLBACK_TITLE
}

async function createAudioSession(title: string) {
  const response = await fetch("/api/studio/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "audio", title }),
  })
  return readJson<StudioSession>(response)
}

async function generateSessionTitle(sessionId: string, prompt: string) {
  await fetch(`/api/studio/sessions/${sessionId}/title`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  })
}

async function submitAudioGeneration({
  sessionId,
  modelId,
  modelName,
  prompt,
  params,
  openapi,
  fields,
  promptFieldKey,
  attachments,
}: {
  sessionId: string
  modelId: string
  modelName: string
  prompt: string
  params: Record<string, unknown>
  openapi: NonNullable<StudioAudioModelOption["openapi"]>
  fields: StudioAudioParameterField[]
  promptFieldKey: string | null
  attachments: Record<string, PendingAudioAttachment[]>
}) {
  const response = await fetch(
    `/api/studio/sessions/${sessionId}/audio-generations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId,
        modelName,
        prompt,
        params,
        openapi,
        fields,
        promptFieldKey,
        attachments: Object.fromEntries(
          Object.entries(attachments).map(([key, items]) => [
            key,
            items.map((item) => ({
              name: item.name,
              mimeType: item.mimeType,
              dataUrl: item.dataUrl,
            })),
          ])
        ),
      }),
    }
  )
  return readJson<StudioAudioGeneration>(response)
}

async function saveAudioOutput(outputId: string) {
  const response = await fetch(`/api/studio/audio-outputs/${outputId}/save`, {
    method: "POST",
  })
  return readJson<StudioAudioOutput>(response)
}

function getAudioOutputContentUrl(outputId: string, download = false) {
  const suffix = download ? "?download=1" : ""

  return `/api/studio/audio-outputs/${encodeURIComponent(outputId)}/content${suffix}`
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function getFieldKey(field: StudioAudioParameterField) {
  return field.payloadPath.join(".") || field.name
}

function getInitialParamValue(field: StudioAudioParameterField) {
  if (field.defaultValue !== undefined) {
    return field.defaultValue
  }

  if (!field.required) {
    return undefined
  }

  if (
    (field.kind === "number" || field.kind === "slider") &&
    typeof field.min === "number"
  ) {
    return field.min
  }

  if (field.kind === "select") {
    return field.options?.[0]?.value
  }

  if (field.kind === "boolean") {
    return false
  }

  return undefined
}

function getInitialParamsForFields(fields: StudioAudioParameterField[]) {
  const initial: Record<string, unknown> = {}

  for (const field of fields) {
    const value = getInitialParamValue(field)

    if (value !== undefined) {
      initial[getFieldKey(field)] = value
    }
  }

  return initial
}

function getStoredModelId(supported: StudioAudioModelOption[]) {
  return getPreferredStudioModelId("audio", supported)
}

function StudioAudioWorkbench({
  sessionId,
  onSessionChange,
  onSessionsChange,
}: StudioAudioWorkbenchProps) {
  const { locale } = useI18n()
  const copy = React.useMemo(() => getAudioCopy(locale), [locale])
  const [models, setModels] = React.useState<{
    supported: StudioAudioModelOption[]
    disabled: StudioAudioModelOption[]
  }>({ supported: [], disabled: [] })
  const [modelsLoading, setModelsLoading] = React.useState(true)
  const [modelsError, setModelsError] = React.useState("")
  const [modelRefreshNonce, setModelRefreshNonce] = React.useState(0)
  const [selectedModelId, setSelectedModelId] = React.useState("")
  const [selectedOperationId, setSelectedOperationId] = React.useState("")
  const [prompt, setPrompt] = React.useState("")
  const [paramValues, setParamValues] = React.useState<Record<string, unknown>>(
    {}
  )
  const [attachments, setAttachments] = React.useState<
    Record<string, PendingAudioAttachment[]>
  >({})
  const [showAdvanced, setShowAdvanced] = React.useState(false)
  const [submitError, setSubmitError] = React.useState("")
  const [generations, setGenerations] = React.useState<StudioAudioGeneration[]>(
    []
  )
  const [savingOutputId, setSavingOutputId] = React.useState<string | null>(
    null
  )

  const selectedModel = React.useMemo(
    () => models.supported.find((option) => option.id === selectedModelId),
    [models.supported, selectedModelId]
  )
  const operations = selectedModel?.operations ?? []
  const selectedOperation =
    operations.find((operation) => operation.id === selectedOperationId) ??
    operations[0] ??
    null

  const fields = selectedOperation?.fields ?? selectedModel?.fields ?? []
  const promptField = fields.find((field) => field.kind === "prompt")
  const promptFieldKey = promptField ? getFieldKey(promptField) : null
  const audioFields = fields.filter(
    (field) => field.kind === "audio" && !field.hidden
  )
  const missingRequiredAudio = audioFields.some(
    (field) => field.required && !attachments[getFieldKey(field)]?.length
  )

  React.useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return
      setModelsLoading(true)
      setModelsError("")

      fetchStudioModelsWithCache("audio", fetchAudioModels, {
        force: modelRefreshNonce > 0,
      })
        .then((data) => {
          if (cancelled) return
          setModels(data)
          setSelectedModelId(getStoredModelId(data.supported))
        })
        .catch((error: unknown) => {
          if (cancelled) return
          setModelsError(
            error instanceof Error ? error.message : copy.modelsFailed
          )
        })
        .finally(() => {
          if (!cancelled) {
            setModelsLoading(false)
          }
        })
    })

    return () => {
      cancelled = true
    }
  }, [copy.modelsFailed, modelRefreshNonce])

  React.useEffect(() => {
    function handleProjectChanged() {
      setModelRefreshNonce((value) => value + 1)
    }

    window.addEventListener(UCLOUD_PROJECT_CHANGED_EVENT, handleProjectChanged)

    return () => {
      window.removeEventListener(
        UCLOUD_PROJECT_CHANGED_EVENT,
        handleProjectChanged
      )
    }
  }, [])

  React.useEffect(() => {
    if (!selectedOperation) {
      queueMicrotask(() => setParamValues({}))
      return
    }

    queueMicrotask(() => {
      setParamValues(getInitialParamsForFields(selectedOperation.fields))
      setAttachments({})
    })
  }, [selectedOperation])

  React.useEffect(() => {
    if (typeof window === "undefined" || !selectedModelId) return
    saveSelectedStudioModel("audio", selectedModelId)
  }, [selectedModelId])

  const reloadGenerations = React.useCallback(
    async (activeSessionId: string) => {
      try {
        const next = await fetchAudioGenerations(activeSessionId)
        setGenerations(next)
      } catch {
        setGenerations([])
      }
    },
    []
  )

  React.useEffect(() => {
    if (!sessionId) {
      queueMicrotask(() => setGenerations([]))
      return
    }
    queueMicrotask(() => {
      void reloadGenerations(sessionId)
    })
  }, [sessionId, reloadGenerations])

  function updateParam(field: StudioAudioParameterField, value: unknown) {
    setParamValues((current) => ({
      ...current,
      [getFieldKey(field)]: value,
    }))
  }

  async function addAudioFiles(
    field: StudioAudioParameterField,
    files: FileList | null
  ) {
    if (!files || files.length === 0) return

    const audioFiles = Array.from(files).filter(
      (file) => file.type.startsWith("audio/") && file.size <= MAX_AUDIO_BYTES
    )

    if (audioFiles.length === 0) return

    const next = await Promise.all(
      audioFiles.slice(0, 1).map(async (file) => ({
        id: createClientId(),
        name: file.name,
        mimeType: file.type,
        dataUrl: await readFileAsDataUrl(file),
      }))
    )
    const fieldKey = getFieldKey(field)

    setAttachments((current) => ({ ...current, [fieldKey]: next }))
  }

  function removeAttachment(field: StudioAudioParameterField, id: string) {
    const fieldKey = getFieldKey(field)
    setAttachments((current) => ({
      ...current,
      [fieldKey]: (current[fieldKey] ?? []).filter((item) => item.id !== id),
    }))
  }

  async function handleSubmit() {
    if (!selectedModel || !selectedOperation || !prompt.trim()) return

    setSubmitError("")

    const optimisticId = `pending-${createClientId()}`
    const promptText = prompt.trim()
    const promptModel = selectedModel
    const promptOperation = selectedOperation
    const promptOpenapi = promptOperation.openapi
    const promptParams = paramValues
    const promptAttachments = attachments
    const activePromptFieldKey = promptFieldKey
    const isNewSession = !sessionId

    const optimistic: StudioAudioGeneration = {
      id: optimisticId,
      sessionId,
      modelSquareId: promptModel.id,
      modelName: promptModel.name,
      manufacturer: promptModel.manufacturer,
      openapiFile: promptOpenapi.file,
      operationId: promptOpenapi.operationId,
      prompt: promptText,
      params: promptParams,
      status: "running",
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      outputs: [],
    }

    setGenerations((current) => [...current, optimistic])
    setAttachments({})

    void (async () => {
      try {
        let activeSessionId = sessionId
        if (!activeSessionId) {
          const session = await createAudioSession(
            getFallbackAudioTitle(promptText)
          )
          activeSessionId = session.id
          onSessionChange(activeSessionId)
          onSessionsChange()
        }

        if (isNewSession) {
          void generateSessionTitle(activeSessionId, promptText)
            .then(() => onSessionsChange())
            .catch(() => {
              // Keep the prompt-based fallback title on failure.
            })
        }

        const result = await submitAudioGeneration({
          sessionId: activeSessionId,
          modelId: promptModel.id,
          modelName: promptModel.name,
          prompt: promptText,
          params: promptParams,
          openapi: promptOpenapi,
          fields: promptOperation.fields,
          promptFieldKey: activePromptFieldKey,
          attachments: promptAttachments,
        })

        setGenerations((current) =>
          current.map((generation) =>
            generation.id === optimisticId ? result : generation
          )
        )
        onSessionsChange()
      } catch (error) {
        const message =
          error instanceof Error ? error.message : copy.submitFailed
        setSubmitError(message)
        setGenerations((current) =>
          current.map((generation) =>
            generation.id === optimisticId
              ? { ...generation, status: "error", errorMessage: message }
              : generation
          )
        )
      }
    })()
  }

  function loadOutputIntoForm(generation: StudioAudioGeneration) {
    const model = models.supported.find(
      (option) => option.id === generation.modelSquareId
    )

    if (!model) {
      return
    }

    const operation = model.operations?.find(
      (item) => item.openapi.operationId === generation.operationId
    )

    setSelectedModelId(generation.modelSquareId)
    setSelectedOperationId(operation?.id ?? "")
    setPrompt(generation.prompt)
    setParamValues(generation.params ?? {})
  }

  async function handleSave(outputId: string) {
    setSavingOutputId(outputId)
    try {
      const saved = await saveAudioOutput(outputId)
      setGenerations((current) =>
        current.map((generation) => ({
          ...generation,
          outputs: generation.outputs.map((output) =>
            output.id === outputId ? saved : output
          ),
        }))
      )
    } catch {
      // User can retry from the output tile.
    } finally {
      setSavingOutputId(null)
    }
  }

  function downloadOutput(output: StudioAudioOutput) {
    const href =
      output.dataUrl ?? output.url ?? getAudioOutputContentUrl(output.id, true)
    if (!href) return
    const anchor = document.createElement("a")
    anchor.href = href
    anchor.download = `audio-${output.id}.mp3`
    anchor.rel = "noreferrer"
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  }

  return (
    <section className="flex h-full min-h-0 flex-1 overflow-hidden bg-background">
      <aside className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-r bg-background px-4 py-4 lg:w-[380px]">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {copy.model}
          </label>
          <Select
            value={selectedModelId}
            onValueChange={(nextModelId) => {
              setSelectedModelId(nextModelId)
              setSelectedOperationId("")
            }}
            disabled={modelsLoading || models.supported.length === 0}
          >
            <SelectTrigger className="w-full rounded-2xl">
              <SelectValue
                placeholder={
                  modelsLoading ? copy.modelsLoading : copy.modelPlaceholder
                }
              />
            </SelectTrigger>
            <SelectContent>
              {models.supported.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {modelsError ? (
            <p className="text-xs text-destructive">{modelsError}</p>
          ) : null}
        </div>

        {operations.length > 1 ? (
          <div className="mt-4 flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {copy.operation}
            </label>
            <Select
              value={selectedOperation?.id ?? ""}
              onValueChange={setSelectedOperationId}
            >
              <SelectTrigger className="w-full rounded-2xl">
                <SelectValue placeholder={copy.operationPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {operations.map((operation) => (
                  <SelectItem key={operation.id} value={operation.id}>
                    {operation.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-1.5">
          {promptField ? (
            <ParameterLabel field={promptField} label={copy.prompt} />
          ) : (
            <label className="text-xs font-medium text-muted-foreground">
              {copy.prompt}
            </label>
          )}
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={copy.promptPlaceholder}
            className="min-h-28 resize-none rounded-2xl"
          />
        </div>

        {audioFields.map((field) => {
          const fieldKey = getFieldKey(field)
          return (
            <AudioAttachmentField
              key={fieldKey}
              field={field}
              attachments={attachments[fieldKey] ?? []}
              onAddFiles={(files) => addAudioFiles(field, files)}
              onRemove={(id) => removeAttachment(field, id)}
            />
          )
        })}

        <div className="mt-4 flex flex-col gap-3">
          {fields
            .filter((field) => !field.advanced && !field.hidden)
            .filter(
              (field) =>
                getFieldKey(field) !== promptFieldKey && field.kind !== "audio"
            )
            .map((field) => (
              <ParameterControl
                key={getFieldKey(field)}
                field={field}
                value={paramValues[getFieldKey(field)]}
                onChange={(value) => updateParam(field, value)}
              />
            ))}
        </div>

        {fields.some((field) => field.advanced && !field.hidden) ? (
          <div className="mt-3 flex flex-col gap-3 border-t pt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced((current) => !current)}
              className="text-left text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {showAdvanced ? copy.advancedHide : copy.advanced}
            </button>
            {showAdvanced
              ? fields
                  .filter((field) => field.advanced && !field.hidden)
                  .filter(
                    (field) =>
                      getFieldKey(field) !== promptFieldKey &&
                      field.kind !== "audio"
                  )
                  .map((field) => (
                    <ParameterControl
                      key={getFieldKey(field)}
                      field={field}
                      value={paramValues[getFieldKey(field)]}
                      onChange={(value) => updateParam(field, value)}
                    />
                  ))
              : null}
          </div>
        ) : null}

        {submitError ? (
          <p className="mt-3 text-xs text-destructive">{submitError}</p>
        ) : null}

        <Button
          type="button"
          className="mt-4 h-10 rounded-2xl"
          onClick={handleSubmit}
          disabled={
            !selectedModel ||
            !selectedOperation ||
            !prompt.trim() ||
            missingRequiredAudio ||
            models.supported.length === 0
          }
        >
          <span>{copy.generate}</span>
        </Button>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background p-4">
        <OutputList
          generations={generations}
          savingOutputId={savingOutputId}
          onSelectGeneration={loadOutputIntoForm}
          onSaveOutput={handleSave}
          onDownloadOutput={downloadOutput}
        />
      </div>
    </section>
  )
}

type ParameterLabelProps = {
  field: StudioAudioParameterField
  label?: string
  className?: string
}

function ParameterLabel({ field, label, className }: ParameterLabelProps) {
  const description = field.description?.trim()

  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <span className="truncate text-xs font-medium text-muted-foreground">
        {label ?? field.label}
      </span>
      {description ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:size-3"
              aria-label={`${label ?? field.label} description`}
            >
              <RiQuestionLine aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            className="max-h-[min(60vh,22rem)] w-72 gap-2 overflow-y-auto rounded-2xl p-3 text-xs leading-relaxed"
          >
            <p className="font-medium text-foreground">
              {label ?? field.label}
            </p>
            <p className="break-words whitespace-pre-wrap text-muted-foreground">
              {description}
            </p>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}

type ParameterControlProps = {
  field: StudioAudioParameterField
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}

function ParameterControl({
  field,
  value,
  onChange,
  disabled,
}: ParameterControlProps) {
  const suggestionListId = React.useId()

  if (field.kind === "boolean") {
    const next = Boolean(value)
    return (
      <div className="flex items-center justify-between gap-2">
        <ParameterLabel field={field} />
        <Toggle
          pressed={next}
          onPressedChange={(pressed) => onChange(pressed)}
          disabled={disabled}
          className="rounded-2xl"
        >
          {next ? "ON" : "OFF"}
        </Toggle>
      </div>
    )
  }

  if (field.kind === "select" && field.options && field.options.length > 0) {
    const noneSentinel = "__none__"
    const selected =
      typeof value === "string" && value.length > 0 ? value : noneSentinel
    const canClear = !field.required
    return (
      <div className="flex flex-col gap-1.5">
        <ParameterLabel field={field} />
        <Select
          value={selected}
          onValueChange={(next) => onChange(next === noneSentinel ? "" : next)}
          disabled={disabled}
        >
          <SelectTrigger className="w-full rounded-2xl">
            <SelectValue placeholder={field.label} />
          </SelectTrigger>
          <SelectContent>
            {canClear ? <SelectItem value={noneSentinel}>-</SelectItem> : null}
            {field.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  if (field.kind === "slider") {
    const min = field.min ?? 0
    const max = field.max ?? 100
    const step = field.step ?? 1
    const numeric =
      typeof value === "number"
        ? value
        : Number(value ?? field.defaultValue ?? min)
    const safe = Number.isFinite(numeric) ? numeric : min
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <ParameterLabel field={field} />
          <Input
            type="number"
            min={min}
            max={max}
            step={step}
            value={safe}
            onChange={(event) => onChange(Number(event.target.value))}
            className="h-7 w-24 rounded-xl text-xs"
            disabled={disabled}
          />
        </div>
        <Slider
          min={min}
          max={max}
          step={step}
          value={[safe]}
          onValueChange={(next) => onChange(next[0])}
          disabled={disabled}
        />
      </div>
    )
  }

  if (field.kind === "number") {
    const numeric =
      typeof value === "number" ? value : value === "" ? "" : value
    return (
      <div className="flex flex-col gap-1.5">
        <ParameterLabel field={field} />
        <Input
          type="number"
          value={numeric as number | string}
          onChange={(event) =>
            onChange(
              event.target.value === "" ? "" : Number(event.target.value)
            )
          }
          className="h-9 rounded-2xl"
          disabled={disabled}
        />
      </div>
    )
  }

  if (field.kind === "textarea") {
    return (
      <div className="flex flex-col gap-1.5">
        <ParameterLabel field={field} />
        <Textarea
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-20 resize-none rounded-2xl"
          disabled={disabled}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <ParameterLabel field={field} />
      <Input
        list={field.suggestedValues?.length ? suggestionListId : undefined}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-2xl"
        disabled={disabled}
      />
      {field.suggestedValues?.length ? (
        <datalist id={suggestionListId}>
          {field.suggestedValues.map((option) => (
            <option
              key={option.value}
              value={option.value}
              label={option.label}
            />
          ))}
        </datalist>
      ) : null}
    </div>
  )
}

function AudioAttachmentField({
  field,
  attachments,
  onAddFiles,
  onRemove,
}: {
  field: StudioAudioParameterField
  attachments: PendingAudioAttachment[]
  onAddFiles: (files: FileList | null) => void
  onRemove: (id: string) => void
}) {
  const { locale } = useI18n()
  const copy = getAudioCopy(locale)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  return (
    <div className="mt-4 flex flex-col gap-2">
      <ParameterLabel field={field} />
      {attachments.length > 0 ? (
        <div className="flex flex-col gap-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex min-w-0 items-center justify-between gap-2 rounded-lg border bg-muted/40 px-2 py-2"
            >
              <span className="truncate text-xs">{attachment.name}</span>
              <button
                type="button"
                className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground [&_svg]:size-3.5"
                onClick={() => onRemove(attachment.id)}
                aria-label="Remove audio"
              >
                <RiCloseLine aria-hidden />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(event) => {
          onAddFiles(event.target.files)
          event.target.value = ""
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit rounded-2xl"
        onClick={() => fileInputRef.current?.click()}
      >
        <RiAddLine aria-hidden />
        <span>{copy.attach}</span>
      </Button>
    </div>
  )
}

function OutputList({
  generations,
  savingOutputId,
  onSelectGeneration,
  onSaveOutput,
  onDownloadOutput,
}: {
  generations: StudioAudioGeneration[]
  savingOutputId: string | null
  onSelectGeneration: (generation: StudioAudioGeneration) => void
  onSaveOutput: (outputId: string) => void
  onDownloadOutput: (output: StudioAudioOutput) => void
}) {
  const { locale } = useI18n()
  const copy = getAudioCopy(locale)

  if (generations.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed bg-muted/20">
        <p className="text-sm text-muted-foreground">{copy.empty}</p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        {generations.toReversed().map((generation) => (
          <GenerationCard
            key={generation.id}
            generation={generation}
            savingOutputId={savingOutputId}
            onSelectGeneration={onSelectGeneration}
            onSaveOutput={onSaveOutput}
            onDownloadOutput={onDownloadOutput}
          />
        ))}
      </div>
    </div>
  )
}

function GenerationCard({
  generation,
  savingOutputId,
  onSelectGeneration,
  onSaveOutput,
  onDownloadOutput,
}: {
  generation: StudioAudioGeneration
  savingOutputId: string | null
  onSelectGeneration: (generation: StudioAudioGeneration) => void
  onSaveOutput: (outputId: string) => void
  onDownloadOutput: (output: StudioAudioOutput) => void
}) {
  const { locale } = useI18n()
  const copy = getAudioCopy(locale)
  const isRunning = generation.status === "running"
  const isError = generation.status === "error"

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-3">
      <button
        type="button"
        className="min-w-0 text-left"
        onClick={() => onSelectGeneration(generation)}
      >
        <p className="line-clamp-2 text-sm font-medium">{generation.prompt}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {generation.modelName}
        </p>
      </button>

      {isRunning ? (
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-3 text-sm text-muted-foreground">
          <RiLoader4Line className="size-4 animate-spin" aria-hidden />
          <span>{copy.running}</span>
        </div>
      ) : null}

      {isError ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {generation.errorMessage ?? copy.failed}
        </p>
      ) : null}

      {generation.outputs.map((output) => (
        <div key={output.id} className="flex min-w-0 flex-col gap-2">
          <AudioOutputPlayer output={output} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-2xl"
              onClick={() => onDownloadOutput(output)}
            >
              <RiDownloadLine aria-hidden />
              <span>{copy.download}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-2xl"
              onClick={() => onSaveOutput(output.id)}
              disabled={Boolean(output.savedAt) || savingOutputId === output.id}
            >
              {savingOutputId === output.id ? (
                <RiLoader4Line className="animate-spin" aria-hidden />
              ) : (
                <RiSaveLine aria-hidden />
              )}
              <span>{output.savedAt ? copy.saved : copy.save}</span>
            </Button>
          </div>
        </div>
      ))}
    </article>
  )
}

function AudioOutputPlayer({ output }: { output: StudioAudioOutput }) {
  const src =
    output.dataUrl ?? output.url ?? getAudioOutputContentUrl(output.id)

  return (
    <AudioPlayer className="w-full rounded-lg border bg-background px-2 py-2">
      <AudioPlayerElement src={src} preload="metadata" />
      <AudioPlayerControlBar className="w-full">
        <AudioPlayerPlayButton />
        <AudioPlayerSeekBackwardButton />
        <AudioPlayerSeekForwardButton />
        <AudioPlayerTimeDisplay />
        <AudioPlayerTimeRange className="min-w-0 flex-1" />
        <AudioPlayerDurationDisplay />
        <AudioPlayerMuteButton />
        <AudioPlayerVolumeRange className="w-20" />
      </AudioPlayerControlBar>
    </AudioPlayer>
  )
}

export { StudioAudioWorkbench }
