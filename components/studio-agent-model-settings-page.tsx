"use client"

import * as React from "react"
import {
  RiAddLine,
  RiDeleteBinLine,
  RiLoader4Line,
} from "@remixicon/react"
import { toast } from "sonner"

import { AgentRuntimeIcon } from "@/components/agent-runtime-icons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useI18n } from "@/components/i18n-provider"
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

type StudioAgentModelSettingsPageProps = {
  embedded?: boolean
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

function toggleItem<T extends string>(items: T[], item: T) {
  return items.includes(item)
    ? items.filter((candidate) => candidate !== item)
    : [...items, item]
}

function normalizeDefaultEffort(
  efforts: ChatReasoningEffort[],
  effort: ChatReasoningEffort
) {
  return efforts.includes(effort) ? effort : (efforts[0] ?? "none")
}

function StudioAgentModelSettingsPage({
  embedded = false,
}: StudioAgentModelSettingsPageProps) {
  const { locale } = useI18n()
  const [payload, setPayload] =
    React.useState<AgentModelSettingsPayload | null>(null)
  const [form, setForm] = React.useState<CustomModelForm>(defaultForm)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [error, setError] = React.useState("")

  const copy =
    locale === "zh"
      ? {
          title: "Agent 模型设置",
          description:
            "配置每个 Agent 默认使用的 Modelverse 模型，或切回本机 CLI 配置。",
          missingKey:
            "尚未选择 Modelverse API Key，Modelverse 模式会无法启动。",
          modelverse: "Modelverse",
          localCli: "本机 CLI",
          localModeHint: "模型由本机 CLI 配置决定",
          modelCount: (count: number) => `${count} 个可用模型`,
          defaultModel: "默认模型",
          unsupported: "当前没有可用模型",
          builtIn: "内置",
          custom: "自定义",
          customModels: "自定义模型",
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
          deleteModel: "删除模型",
          saved: "Agent 模型设置已保存。",
          newSessionRequired:
            "Codex、Claude Code 和 OpenCode 的 Modelverse 配置会在新建会话后生效。",
          saveFailed: "保存 Agent 模型设置失败。",
          loadFailed: "加载 Agent 模型设置失败。",
          required: "请填写模型 ID、显示名和 Provider 模型名。",
          noCustomModels: "暂无自定义模型。",
          astraflowLocalHint: "AstraFlow 始终使用应用内 Modelverse 配置。",
        }
      : {
          title: "Agent models",
          description:
            "Configure each agent's default Modelverse model, or switch back to local CLI settings.",
          missingKey:
            "No Modelverse API key is selected. Modelverse mode cannot start.",
          modelverse: "Modelverse",
          localCli: "Local CLI",
          localModeHint: "Model follows the local CLI configuration",
          modelCount: (count: number) =>
            `${count} model${count === 1 ? "" : "s"} available`,
          defaultModel: "Default model",
          unsupported: "No compatible model",
          builtIn: "Built-in",
          custom: "Custom",
          customModels: "Custom models",
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
          deleteModel: "Delete model",
          saved: "Agent model settings saved.",
          newSessionRequired:
            "Modelverse settings for Codex, Claude Code, and OpenCode take effect in new sessions.",
          saveFailed: "Failed to save agent model settings.",
          loadFailed: "Failed to load agent model settings.",
          required: "Enter a model ID, display name, and provider model.",
          noCustomModels: "No custom models yet.",
          astraflowLocalHint:
            "AstraFlow always uses the app Modelverse config.",
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

  const content = (
    <>
      {!embedded ? (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-4xl font-semibold tracking-normal">
              {copy.title}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              {copy.description}
            </p>
          </div>
          {isLoading || isSaving ? (
            <RiLoader4Line
              className="mt-1 size-5 shrink-0 animate-spin text-muted-foreground"
              aria-hidden
            />
          ) : null}
        </div>
      ) : isLoading || isSaving ? (
        <div className="flex justify-end">
          <RiLoader4Line
            className="size-5 shrink-0 animate-spin text-muted-foreground"
            aria-hidden
          />
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {payload && !payload.hasModelverseApiKey ? (
        <div className="rounded-lg border bg-muted/45 px-3 py-2 text-sm text-muted-foreground">
          {copy.missingKey}
        </div>
      ) : null}

      {payload ? (
        <section className="grid gap-3">
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
              <Card
                key={runtimeId}
                size="sm"
                className="rounded-2xl border-border/80 bg-card/95 py-0 shadow-sm ring-0"
              >
                <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/40">
                      <AgentRuntimeIcon
                        runtimeId={runtimeId}
                        className={cn(
                          "size-5",
                          runtimeId === "claude-code" && "text-[#D97757]",
                          runtimeId === "codex" && "text-foreground"
                        )}
                      />
                    </span>
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base font-semibold">
                        {runtimeLabels[runtimeId]}
                      </CardTitle>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {secondaryText}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
                    {canUseLocalSettings ? (
                      <div className="flex h-10 w-fit items-center rounded-xl bg-muted/60 p-1 text-sm font-medium">
                        <button
                          type="button"
                          disabled={isSaving}
                          className={cn(
                            "h-8 rounded-lg px-3 transition-colors",
                            !setting.useLocalSettings
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                          onClick={() =>
                            updateRuntime(runtimeId, {
                              useLocalSettings: false,
                            })
                          }
                        >
                          {copy.modelverse}
                        </button>
                        <button
                          type="button"
                          disabled={isSaving}
                          className={cn(
                            "h-8 rounded-lg px-3 transition-colors",
                            setting.useLocalSettings
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                          onClick={() =>
                            updateRuntime(runtimeId, {
                              useLocalSettings: true,
                            })
                          }
                        >
                          {copy.localCli}
                        </button>
                      </div>
                    ) : null}
                    <Select
                      value={selectedModel}
                      disabled={
                        isSaving ||
                        setting.useLocalSettings ||
                        compatibleModels.length === 0
                      }
                      onValueChange={(defaultModel) =>
                        updateRuntime(runtimeId, { defaultModel })
                      }
                    >
                      <SelectTrigger className="h-10 w-full rounded-xl border-border/70 bg-muted/25 px-3 shadow-none data-[size=default]:h-10 sm:w-52">
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
                </CardContent>
              </Card>
            )
          })}
        </section>
      ) : null}

      <Card
        size="sm"
        className="rounded-2xl border-border/80 bg-card/95 py-0 shadow-sm ring-0"
      >
        <CardHeader className="border-b px-4 py-4">
          <CardTitle className="text-lg font-semibold">
            {copy.customModels}
          </CardTitle>
          <CardDescription className="leading-6">
            {copy.customDescription}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 p-4">
          <FieldGroup className="gap-5">
            <div className="grid gap-3 md:grid-cols-3">
              <Field>
                <FieldLabel>{copy.modelId}</FieldLabel>
                <Input
                  value={form.id}
                  placeholder={copy.modelId}
                  className="h-11 rounded-xl bg-muted/30"
                  onChange={(event) => updateForm({ id: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel>{copy.displayName}</FieldLabel>
                <Input
                  value={form.label}
                  placeholder={copy.displayName}
                  className="h-11 rounded-xl bg-muted/30"
                  onChange={(event) =>
                    updateForm({ label: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel>{copy.providerModel}</FieldLabel>
                <Input
                  value={form.providerModel}
                  placeholder={copy.providerModel}
                  className="h-11 rounded-xl bg-muted/30"
                  onChange={(event) =>
                    updateForm({ providerModel: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel>{copy.protocol}</FieldLabel>
                <Select
                  value={form.protocol}
                  onValueChange={(protocol) =>
                    updateForm({ protocol: protocol as AgentModelProtocol })
                  }
                >
                  <SelectTrigger className="h-11 w-full rounded-xl bg-muted/30 data-[size=default]:h-11">
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
                <FieldLabel>{copy.baseUrl}</FieldLabel>
                <Input
                  value={form.baseUrl}
                  placeholder={copy.baseUrl}
                  className="h-11 rounded-xl bg-muted/30"
                  onChange={(event) =>
                    updateForm({ baseUrl: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel>{copy.defaultThinking}</FieldLabel>
                <Select
                  value={form.defaultReasoningEffort}
                  onValueChange={(defaultReasoningEffort) =>
                    updateForm({
                      defaultReasoningEffort:
                        defaultReasoningEffort as ChatReasoningEffort,
                    })
                  }
                >
                  <SelectTrigger className="h-11 w-full rounded-xl bg-muted/30 data-[size=default]:h-11">
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

            <div className="grid gap-4 md:grid-cols-2">
              <FieldSet className="gap-2">
                <FieldLegend variant="label">
                  {copy.supportedAgents}
                </FieldLegend>
                <div className="flex flex-wrap gap-2">
                  {PUBLIC_AGENT_RUNTIME_IDS.map((runtimeId) => {
                    const checked = form.supportedRuntimeIds.includes(runtimeId)

                    return (
                      <Label
                        key={runtimeId}
                        className={cn(
                          "flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-border/80 bg-background px-3 text-sm transition-colors hover:bg-muted/45",
                          checked &&
                            "border-primary/35 bg-primary/5 text-primary"
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() =>
                            updateForm({
                              supportedRuntimeIds: toggleItem(
                                form.supportedRuntimeIds,
                                runtimeId
                              ),
                            })
                          }
                        />
                        <AgentRuntimeIcon
                          runtimeId={runtimeId}
                          className="size-4"
                        />
                        {runtimeLabels[runtimeId]}
                      </Label>
                    )
                  })}
                </div>
              </FieldSet>

              <FieldSet className="gap-2">
                <FieldLegend variant="label">{copy.thinking}</FieldLegend>
                <div className="flex flex-wrap gap-2">
                  {SUPPORTED_CHAT_REASONING_EFFORTS.map((effort) => {
                    const checked = form.reasoningEfforts.includes(effort)

                    return (
                      <Label
                        key={effort}
                        className={cn(
                          "flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-border/80 bg-background px-3 text-sm transition-colors hover:bg-muted/45",
                          checked &&
                            "border-primary/35 bg-primary/5 text-primary"
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() =>
                            updateForm({
                              reasoningEfforts: toggleItem(
                                form.reasoningEfforts,
                                effort
                              ),
                            })
                          }
                        />
                        {effort}
                      </Label>
                    )
                  })}
                </div>
              </FieldSet>
            </div>
          </FieldGroup>

          <div className="flex justify-end">
            <Button
              type="button"
              className="h-10 rounded-xl"
              disabled={isSaving}
              onClick={() => void addCustomModel()}
            >
              <RiAddLine data-icon="inline-start" />
              {copy.addModel}
            </Button>
          </div>

          <div className="grid gap-2">
            {customModels.length > 0 ? (
              customModels.map((model) => (
                <div
                  key={model.id}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border/70 bg-background px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-semibold">
                        {model.label}
                      </span>
                      <Badge variant="outline" className="bg-muted/35">
                        {protocolLabels[model.protocol]}
                      </Badge>
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {model.providerModel} ·{" "}
                      {model.supportedRuntimeIds
                        .map((runtimeId) => runtimeLabels[runtimeId])
                        .join(", ")}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={copy.deleteModel}
                    disabled={isSaving}
                    onClick={() => void deleteModel(model.id)}
                  >
                    <RiDeleteBinLine aria-hidden />
                  </Button>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed bg-background px-3 py-3 text-sm text-muted-foreground">
                {copy.noCustomModels}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  )

  if (embedded) {
    return <div className="flex w-full min-w-0 flex-col gap-5">{content}</div>
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-6">
        {content}
      </div>
    </main>
  )
}

export { StudioAgentModelSettingsPage }
