"use client"

import * as React from "react"
import {
  RiAddLine,
  RiDeleteBinLine,
  RiErrorWarningLine,
  RiInformationLine,
  RiLoader4Line,
} from "@remixicon/react"
import { toast } from "sonner"

import { AgentRuntimeIcon } from "@/components/agent-runtime-icons"
import { useI18n } from "@/components/i18n-provider"
import {
  SettingsEmptyRow,
  SettingsPage,
  SettingsPageHeader,
  SettingsSection,
} from "@/components/settings-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  AGENT_MODEL_PROTOCOLS,
  PUBLIC_AGENT_RUNTIME_IDS,
  type AgentModelDefinition,
  type AgentModelProtocol,
  type AgentModelSettingsPayload,
  type AgentRuntimeId,
} from "@/lib/agent-model-settings-shared"
import {
  SUPPORTED_CHAT_REASONING_EFFORTS,
  type ChatReasoningEffort,
} from "@/lib/chat-models"
import { cn } from "@/lib/utils"

type AgentModelSettingsResponse =
  | {
      ok: true
      data: AgentModelSettingsPayload
    }
  | {
      ok: false
      message?: string
      error?: unknown
    }

type CustomModelForm = {
  id: string
  label: string
  providerModel: string
  protocol: AgentModelProtocol
  baseUrl: string
  supportedRuntimeIds: AgentRuntimeId[]
  reasoningEfforts: ChatReasoningEffort[]
  defaultReasoningEffort: ChatReasoningEffort
}

const runtimeLabels: Record<AgentRuntimeId, string> = {
  astraflow: "AstraFlow",
  codex: "Codex",
  "codex-direct": "Codex Direct",
  "claude-code": "Claude Code",
  "claude-native": "Claude Native",
  opencode: "OpenCode",
  "opencode-native": "OpenCode Native",
}

const protocolLabels: Record<AgentModelProtocol, string> = {
  "openai-chat": "OpenAI Chat",
  "openai-responses": "OpenAI Responses",
  "anthropic-messages": "Anthropic Messages",
}

const defaultForm: CustomModelForm = {
  id: "",
  label: "",
  providerModel: "",
  protocol: "openai-chat",
  baseUrl: "",
  supportedRuntimeIds: ["astraflow", "opencode"],
  reasoningEfforts: ["none", "low", "medium", "high"],
  defaultReasoningEffort: "medium",
}

async function readPayload(response: Response) {
  const payload = (await response.json()) as AgentModelSettingsResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && (payload.message || String(payload.error ?? ""))) ||
        "Request failed."
    )
  }

  return payload.data
}

function modelSupportsRuntime(model: AgentModelDefinition, runtimeId: string) {
  return model.supportedRuntimeIds.some((candidate) => candidate === runtimeId)
}

function normalizeDefaultEffort(
  efforts: ChatReasoningEffort[],
  effort: ChatReasoningEffort
) {
  return efforts.includes(effort) ? effort : (efforts[0] ?? "none")
}

function StudioAgentModelSettingsPage() {
  const { locale, t } = useI18n()
  const [payload, setPayload] =
    React.useState<AgentModelSettingsPayload | null>(null)
  const [form, setForm] = React.useState<CustomModelForm>(defaultForm)
  const [formOpen, setFormOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [error, setError] = React.useState("")

  const copy =
    locale === "zh"
      ? {
          title: "Agent 模型",
          missingKeyTitle: "尚未选择 Modelverse API Key",
          missingKey: "在 API 密钥页选择一个密钥后，Modelverse 模式才能启动。",
          modelverse: "Modelverse",
          localCli: "本机 CLI",
          localModeHint: "模型由本机 CLI 配置决定",
          modelCount: (count: number) => `${count} 个可用模型`,
          defaultModel: "默认模型",
          unsupported: "当前没有可用模型",
          customDescription:
            "按模型声明协议和支持的 Agent；OpenCode 可以同时使用不同协议的模型。",
          modelId: "模型 ID",
          displayName: "显示名",
          providerModel: "Provider 模型名",
          protocol: "协议",
          baseUrl: "Base URL（可选）",
          supportedAgents: "支持的 Agent",
          thinking: "思考档位",
          defaultThinking: "默认思考",
          addModel: "添加模型",
          addModelHint: "自定义模型对所有支持它的 Agent 运行时可见。",
          deleteModel: "删除模型",
          cancel: "取消",
          saved: "Agent 模型设置已保存。",
          newSessionRequired:
            "Codex、Claude Code 和 OpenCode 的 Modelverse 配置会在新建会话后生效。",
          saveFailed: "保存 Agent 模型设置失败。",
          loadFailed: "加载 Agent 模型设置失败。",
          required: "请填写模型 ID、显示名和 Provider 模型名。",
          noCustomModels: "暂无自定义模型",
          noCustomModelsHint: "点击右上角「添加模型」接入你自己的模型。",
          astraflowLocalHint: "AstraFlow 始终使用应用内 Modelverse 配置。",
        }
      : {
          title: "Agent models",
          missingKeyTitle: "No Modelverse API key selected",
          missingKey:
            "Pick a key on the API keys page before starting Modelverse mode.",
          modelverse: "Modelverse",
          localCli: "Local CLI",
          localModeHint: "Model follows the local CLI configuration",
          modelCount: (count: number) =>
            `${count} model${count === 1 ? "" : "s"} available`,
          defaultModel: "Default model",
          unsupported: "No compatible model",
          customDescription:
            "Declare each model's protocol and supported agents. OpenCode can mix protocols per model.",
          modelId: "Model ID",
          displayName: "Display name",
          providerModel: "Provider model",
          protocol: "Protocol",
          baseUrl: "Base URL (optional)",
          supportedAgents: "Supported agents",
          thinking: "Thinking modes",
          defaultThinking: "Default thinking",
          addModel: "Add model",
          addModelHint:
            "Custom models are visible to every runtime that supports them.",
          deleteModel: "Delete model",
          cancel: "Cancel",
          saved: "Agent model settings saved.",
          newSessionRequired:
            "Modelverse settings for Codex, Claude Code, and OpenCode take effect in new sessions.",
          saveFailed: "Failed to save agent model settings.",
          loadFailed: "Failed to load agent model settings.",
          required: "Enter a model ID, display name, and provider model.",
          noCustomModels: "No custom models yet",
          noCustomModelsHint: "Use “Add model” to register your own model.",
          astraflowLocalHint: "AstraFlow always uses the app Modelverse config.",
        }

  const load = React.useCallback(async () => {
    try {
      setIsLoading(true)
      setError("")
      const response = await fetch("/api/studio/agent-model-settings", {
        cache: "no-store",
      })
      setPayload(await readPayload(response))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : copy.loadFailed)
    } finally {
      setIsLoading(false)
    }
  }, [copy.loadFailed])

  React.useEffect(() => {
    queueMicrotask(() => {
      void load()
    })
  }, [load])

  function showSavedToast() {
    toast.success(copy.saved, {
      description: copy.newSessionRequired,
    })
  }

  async function saveSettings(next: AgentModelSettingsPayload) {
    setPayload(next)
    setIsSaving(true)

    try {
      const response = await fetch("/api/studio/agent-model-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runtimes: next.runtimes,
          customModels: next.customModels,
        }),
      })

      setPayload(await readPayload(response))
      showSavedToast()
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : copy.saveFailed
      )
      void load()
    } finally {
      setIsSaving(false)
    }
  }

  async function addCustomModel() {
    if (!form.id.trim() || !form.label.trim() || !form.providerModel.trim()) {
      toast.error(copy.required)
      return
    }

    setIsSaving(true)

    try {
      const response = await fetch("/api/studio/agent-model-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          baseUrl: form.baseUrl.trim() || null,
          defaultReasoningEffort: normalizeDefaultEffort(
            form.reasoningEfforts,
            form.defaultReasoningEffort
          ),
        }),
      })

      setPayload(await readPayload(response))
      setForm(defaultForm)
      setFormOpen(false)
      showSavedToast()
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : copy.saveFailed
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function deleteModel(modelId: string) {
    setIsSaving(true)

    try {
      const response = await fetch(
        `/api/studio/agent-model-settings/models/${encodeURIComponent(
          modelId
        )}`,
        { method: "DELETE" }
      )

      setPayload(await readPayload(response))
      showSavedToast()
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : copy.saveFailed
      )
    } finally {
      setIsSaving(false)
    }
  }

  function updateRuntime(
    runtimeId: AgentRuntimeId,
    updates: Partial<AgentModelSettingsPayload["runtimes"][AgentRuntimeId]>
  ) {
    if (!payload) {
      return
    }

    void saveSettings({
      ...payload,
      runtimes: {
        ...payload.runtimes,
        [runtimeId]: {
          ...payload.runtimes[runtimeId],
          ...updates,
        },
      },
    })
  }

  function updateForm(updates: Partial<CustomModelForm>) {
    setForm((current) => {
      const next = { ...current, ...updates }
      const efforts = next.reasoningEfforts.length
        ? next.reasoningEfforts
        : ["none" as const]

      return {
        ...next,
        reasoningEfforts: efforts,
        defaultReasoningEffort: normalizeDefaultEffort(
          efforts,
          next.defaultReasoningEffort
        ),
      }
    })
  }

  const customModels = payload?.customModels ?? []

  return (
    <SettingsPage>
      <SettingsPageHeader
        busy={isLoading || isSaving}
        description={t.settingsAgentsDescription}
        title={copy.title}
      />

      {error ? (
        <Alert variant="destructive">
          <RiErrorWarningLine aria-hidden />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      ) : null}

      {payload && !payload.hasModelverseApiKey ? (
        <Alert>
          <RiInformationLine aria-hidden />
          <AlertTitle>{copy.missingKeyTitle}</AlertTitle>
          <AlertDescription>{copy.missingKey}</AlertDescription>
        </Alert>
      ) : null}

      {payload ? (
        <SettingsSection title={t.settingsRuntimeModelsSection}>
          {PUBLIC_AGENT_RUNTIME_IDS.map((runtimeId) => {
            const setting = payload.runtimes[runtimeId]
            const compatibleModels = payload.models.filter((model) =>
              modelSupportsRuntime(model, runtimeId)
            )
            const selectedModel = compatibleModels.some(
              (model) => model.id === setting.defaultModel
            )
              ? setting.defaultModel
              : (compatibleModels[0]?.id ?? "")
            const canUseLocalSettings = runtimeId !== "astraflow"
            const secondaryText = !canUseLocalSettings
              ? copy.astraflowLocalHint
              : setting.useLocalSettings
                ? copy.localModeHint
                : compatibleModels.length
                  ? copy.modelCount(compatibleModels.length)
                  : copy.unsupported

            return (
              <div
                className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between"
                key={runtimeId}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border/70 bg-muted/40">
                    <AgentRuntimeIcon
                      className={cn(
                        "size-4.5",
                        runtimeId === "claude-code" && "text-[#D97757]",
                        runtimeId === "codex" && "text-foreground"
                      )}
                      runtimeId={runtimeId}
                    />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {runtimeLabels[runtimeId]}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {secondaryText}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {canUseLocalSettings ? (
                    <ToggleGroup
                      disabled={isSaving}
                      onValueChange={(value) => {
                        if (value === "modelverse" || value === "local") {
                          updateRuntime(runtimeId, {
                            useLocalSettings: value === "local",
                          })
                        }
                      }}
                      size="sm"
                      spacing={0}
                      type="single"
                      value={setting.useLocalSettings ? "local" : "modelverse"}
                      variant="outline"
                    >
                      <ToggleGroupItem value="modelverse">
                        {copy.modelverse}
                      </ToggleGroupItem>
                      <ToggleGroupItem value="local">
                        {copy.localCli}
                      </ToggleGroupItem>
                    </ToggleGroup>
                  ) : null}
                  <Select
                    disabled={
                      isSaving ||
                      setting.useLocalSettings ||
                      compatibleModels.length === 0
                    }
                    onValueChange={(defaultModel) =>
                      updateRuntime(runtimeId, { defaultModel })
                    }
                    value={selectedModel}
                  >
                    <SelectTrigger
                      aria-label={copy.defaultModel}
                      className="w-44 justify-between"
                      size="sm"
                    >
                      <SelectValue placeholder={copy.defaultModel} />
                    </SelectTrigger>
                    <SelectContent align="end" position="popper">
                      <SelectGroup>
                        {compatibleModels.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )
          })}
        </SettingsSection>
      ) : null}

      <SettingsSection
        action={
          <Button
            disabled={isSaving || isLoading}
            onClick={() => setFormOpen(true)}
            size="sm"
            type="button"
          >
            <RiAddLine data-icon="inline-start" />
            {copy.addModel}
          </Button>
        }
        description={copy.customDescription}
        title={t.settingsCustomModelsSection}
      >
        {customModels.length > 0 ? (
          customModels.map((model) => (
            <div
              className="flex items-center justify-between gap-4 px-4 py-2.5"
              key={model.id}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {model.label}
                  </span>
                  <Badge variant="outline">
                    {protocolLabels[model.protocol]}
                  </Badge>
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  <span className="font-mono">{model.providerModel}</span>
                  {" · "}
                  {model.supportedRuntimeIds
                    .map((runtimeId) => runtimeLabels[runtimeId])
                    .join(", ")}
                </div>
              </div>
              <Button
                aria-label={copy.deleteModel}
                disabled={isSaving}
                onClick={() => void deleteModel(model.id)}
                size="icon-sm"
                title={copy.deleteModel}
                type="button"
                variant="ghost"
              >
                <RiDeleteBinLine aria-hidden />
              </Button>
            </div>
          ))
        ) : (
          <SettingsEmptyRow>
            <span className="font-medium text-foreground">
              {copy.noCustomModels}
            </span>
            <span>{copy.noCustomModelsHint}</span>
          </SettingsEmptyRow>
        )}
      </SettingsSection>

      <Dialog
        onOpenChange={(open) => {
          setFormOpen(open)

          if (!open) {
            setForm(defaultForm)
          }
        }}
        open={formOpen}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{copy.addModel}</DialogTitle>
            <DialogDescription>{copy.addModelHint}</DialogDescription>
          </DialogHeader>

          <FieldGroup className="gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="custom-model-id">
                  {copy.modelId}
                </FieldLabel>
                <Input
                  autoFocus
                  id="custom-model-id"
                  onChange={(event) => updateForm({ id: event.target.value })}
                  placeholder="my-model"
                  value={form.id}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="custom-model-label">
                  {copy.displayName}
                </FieldLabel>
                <Input
                  id="custom-model-label"
                  onChange={(event) =>
                    updateForm({ label: event.target.value })
                  }
                  placeholder="My Model"
                  value={form.label}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="custom-model-provider">
                  {copy.providerModel}
                </FieldLabel>
                <Input
                  id="custom-model-provider"
                  onChange={(event) =>
                    updateForm({ providerModel: event.target.value })
                  }
                  placeholder="deepseek-ai/DeepSeek-V3"
                  value={form.providerModel}
                />
              </Field>
              <Field>
                <FieldLabel>{copy.protocol}</FieldLabel>
                <Select
                  onValueChange={(protocol) =>
                    updateForm({ protocol: protocol as AgentModelProtocol })
                  }
                  value={form.protocol}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={copy.protocol} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {AGENT_MODEL_PROTOCOLS.map((protocol) => (
                        <SelectItem key={protocol} value={protocol}>
                          {protocolLabels[protocol]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="custom-model-base-url">
                  {copy.baseUrl}
                </FieldLabel>
                <Input
                  id="custom-model-base-url"
                  onChange={(event) =>
                    updateForm({ baseUrl: event.target.value })
                  }
                  placeholder="https://"
                  value={form.baseUrl}
                />
              </Field>
              <Field>
                <FieldLabel>{copy.defaultThinking}</FieldLabel>
                <Select
                  onValueChange={(defaultReasoningEffort) =>
                    updateForm({
                      defaultReasoningEffort:
                        defaultReasoningEffort as ChatReasoningEffort,
                    })
                  }
                  value={form.defaultReasoningEffort}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={copy.defaultThinking} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {form.reasoningEfforts.map((effort) => (
                        <SelectItem key={effort} value={effort}>
                          {effort}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <FieldSet className="gap-2">
              <FieldLegend variant="label">{copy.supportedAgents}</FieldLegend>
              <ToggleGroup
                className="flex-wrap"
                onValueChange={(values) =>
                  updateForm({
                    supportedRuntimeIds: values as AgentRuntimeId[],
                  })
                }
                size="sm"
                type="multiple"
                value={form.supportedRuntimeIds}
                variant="outline"
              >
                {PUBLIC_AGENT_RUNTIME_IDS.map((runtimeId) => (
                  <ToggleGroupItem key={runtimeId} value={runtimeId}>
                    <AgentRuntimeIcon
                      className="size-3.5"
                      runtimeId={runtimeId}
                    />
                    {runtimeLabels[runtimeId]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </FieldSet>

            <FieldSet className="gap-2">
              <FieldLegend variant="label">{copy.thinking}</FieldLegend>
              <ToggleGroup
                className="flex-wrap"
                onValueChange={(values) =>
                  updateForm({
                    reasoningEfforts: values as ChatReasoningEffort[],
                  })
                }
                size="sm"
                type="multiple"
                value={form.reasoningEfforts}
                variant="outline"
              >
                {SUPPORTED_CHAT_REASONING_EFFORTS.map((effort) => (
                  <ToggleGroupItem key={effort} value={effort}>
                    {effort}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </FieldSet>
          </FieldGroup>

          <DialogFooter>
            <Button
              disabled={isSaving}
              onClick={() => setFormOpen(false)}
              type="button"
              variant="outline"
            >
              {copy.cancel}
            </Button>
            <Button
              disabled={isSaving}
              onClick={() => void addCustomModel()}
              type="button"
            >
              {isSaving ? (
                <RiLoader4Line
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <RiAddLine data-icon="inline-start" />
              )}
              {copy.addModel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPage>
  )
}

export { StudioAgentModelSettingsPage }
