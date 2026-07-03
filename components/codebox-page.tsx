"use client"

import * as React from "react"
import {
  RiArrowRightUpLine,
  RiArrowUpLine,
  RiCheckLine,
  RiCloseLine,
  RiCodeBoxLine,
  RiDeleteBin6Line,
  RiEditLine,
  RiFileCopyLine,
  RiFolderLine,
  RiGithubLine,
  RiInformationLine,
  RiLoader4Line,
  RiPauseLine,
  RiPlayLine,
  RiRefreshLine,
  RiRestartLine,
  RiTerminalBoxLine,
} from "@remixicon/react"
import { toast } from "sonner"

import { useI18n } from "@/components/i18n-provider"
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
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  CodeBoxDirectoryList,
  CodeBoxGithubStatus,
  CodeBoxLocalDependencyStatus,
  CodeBoxSandbox,
  CodeBoxSshAccess,
  CodeBoxStatus,
} from "@/lib/codebox-types"
import { UCLOUD_PROJECT_CHANGED_EVENT } from "@/lib/project-selection"
import { cn } from "@/lib/utils"

type SandboxFilter = "all" | "running" | "paused"

type ApiEnvelope<T> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      message?: string
      error?: unknown
    }

type GithubDeviceFlow = {
  flowId: string
  userCode: string
  verificationUri: string
  expiresAt: string
  interval: number
}

type GithubPollResult =
  | {
      status: "pending"
      interval?: number
    }
  | {
      status: "expired" | "error"
      message?: string
    }
  | {
      status: "complete"
      github: CodeBoxGithubStatus
    }

type ModelverseApiKeyOption = {
  id: string
  name: string
}

type ModelverseApiKeysResponse = {
  projectId: string
  items: ModelverseApiKeyOption[]
  selected: ModelverseApiKeyOption | null
}

type SaveModelverseApiKeyResponse = {
  projectId: string
  selected: ModelverseApiKeyOption
}

type ConfirmAction =
  | {
      kind: "sandbox"
      sandbox: CodeBoxSandbox
    }

const DEFAULT_CODEBOX_WORKSPACE_PATH = "/root/workspace"

function VSCodeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("shrink-0 text-[#007acc]", className)}
      fill="none"
    >
      <path
        fill="currentColor"
        d="M18.2 3.2 9.35 10.05 4.6 6.45 2.25 7.85 6.95 12l-4.7 4.15 2.35 1.4 4.75-3.6 8.85 6.85c1.05.8 2.55.05 2.55-1.25V4.45c0-1.3-1.5-2.05-2.55-1.25Zm-.45 4.3v9L11.95 12l5.8-4.5Z"
      />
    </svg>
  )
}

async function apiRequest<T>(
  url: string,
  init?: RequestInit,
  fallbackMessage = "Request failed."
) {
  const headers = new Headers(init?.headers)

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  })
  const payload = (await response
    .json()
    .catch(() => null)) as ApiEnvelope<T> | null

  if (!response.ok || !payload?.ok) {
    const message =
      payload && "message" in payload && payload.message
        ? payload.message
        : fallbackMessage

    throw new Error(message)
  }

  return payload.data
}

function formatDate(value: string | null, locale?: string) {
  if (!value) {
    return "-"
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function getRepoName(repoUrl: string) {
  try {
    const url = new URL(repoUrl)
    const parts = url.pathname
      .replace(/\.git$/i, "")
      .split("/")
      .filter(Boolean)

    return parts.slice(-2).join("/") || repoUrl
  } catch {
    return repoUrl.replace(/\.git$/i, "")
  }
}

function normalizeWorkspaceDirectoryPath(path: string) {
  const trimmed = path.trim()

  if (!trimmed) {
    throw new Error("Workspace directory is required.")
  }

  if (!trimmed.startsWith("/")) {
    throw new Error("Workspace directory must be an absolute path.")
  }

  if (trimmed.includes("\0")) {
    throw new Error("Workspace directory contains an invalid character.")
  }

  const parts: string[] = []

  for (const part of trimmed.split("/")) {
    if (!part || part === ".") {
      continue
    }

    if (part === "..") {
      if (parts.length === 0) {
        throw new Error("Workspace directory cannot escape root.")
      }

      parts.pop()
      continue
    }

    parts.push(part)
  }

  return `/${parts.join("/")}` || "/"
}

function createWorkspaceUrl(sandbox: CodeBoxSandbox, workspacePath: string) {
  const baseUrl = sandbox.codeServerUrl

  if (!baseUrl) {
    throw new Error("CodeBox URL is unavailable.")
  }

  const url = new URL(baseUrl)
  url.searchParams.set("folder", workspacePath)

  return url.toString()
}

function getSandboxStatusLabel(
  status: CodeBoxSandbox["status"],
  t: ReturnType<typeof useI18n>["t"]
) {
  if (status === "running") {
    return t.codeboxStatusRunning
  }

  if (status === "paused") {
    return t.codeboxStatusPaused
  }

  return t.codeboxStatusUnknown
}

function copyWithFallback(value: string) {
  let eventCopied = false
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) {
      return
    }

    event.clipboardData.setData("text/plain", value)
    event.preventDefault()
    eventCopied = true
  }

  document.addEventListener("copy", onCopy)

  try {
    document.execCommand("copy")

    if (eventCopied) {
      return true
    }
  } finally {
    document.removeEventListener("copy", onCopy)
  }

  const textarea = document.createElement("textarea")
  const selection = document.getSelection()
  const selectedRanges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange()
      )
    : []
  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

  textarea.value = value
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.top = "0"
  textarea.style.left = "0"
  textarea.style.width = "1px"
  textarea.style.height = "1px"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.focus({ preventScroll: true })
  textarea.select()
  textarea.setSelectionRange(0, value.length)

  try {
    return document.execCommand("copy")
  } finally {
    document.body.removeChild(textarea)
    selection?.removeAllRanges()
    selectedRanges.forEach((range) => selection?.addRange(range))
    activeElement?.focus({ preventScroll: true })
  }
}

async function writeClipboard(value: string) {
  if (copyWithFallback(value)) {
    return true
  }

  if (!window.isSecureContext || !navigator.clipboard?.writeText) {
    return false
  }

  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

function CodeBoxPage() {
  const { t } = useI18n()
  const [status, setStatus] = React.useState<CodeBoxStatus | null>(null)
  const [sandboxes, setSandboxes] = React.useState<CodeBoxSandbox[]>([])
  const [sandboxName, setSandboxName] = React.useState("")
  const [repoUrl, setRepoUrl] = React.useState("")
  const [apiKeys, setApiKeys] = React.useState<ModelverseApiKeyOption[]>([])
  const [selectedApiKeyId, setSelectedApiKeyId] = React.useState("")
  const [isApiKeyLoading, setIsApiKeyLoading] = React.useState(true)
  const [sandboxFilter, setSandboxFilter] = React.useState<SandboxFilter>("all")
  const [isLoading, setIsLoading] = React.useState(true)
  const [busyAction, setBusyAction] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [githubFlow, setGithubFlow] = React.useState<GithubDeviceFlow | null>(
    null
  )
  const [githubDialogOpen, setGithubDialogOpen] = React.useState(false)
  const [githubMessage, setGithubMessage] = React.useState("")
  const [confirmAction, setConfirmAction] =
    React.useState<ConfirmAction | null>(null)
  const [confirmSandboxId, setConfirmSandboxId] = React.useState("")
  const [editingSandbox, setEditingSandbox] =
    React.useState<CodeBoxSandbox | null>(null)
  const [editingSandboxName, setEditingSandboxName] = React.useState("")
  const [workspaceSandbox, setWorkspaceSandbox] =
    React.useState<CodeBoxSandbox | null>(null)
  const [workspacePath, setWorkspacePath] = React.useState(
    DEFAULT_CODEBOX_WORKSPACE_PATH
  )
  const [sshSandbox, setSshSandbox] = React.useState<CodeBoxSandbox | null>(
    null
  )
  const [sshAccess, setSshAccess] = React.useState<CodeBoxSshAccess | null>(
    null
  )
  const [localDependencies, setLocalDependencies] =
    React.useState<CodeBoxLocalDependencyStatus | null>(null)
  const [sshError, setSshError] = React.useState<string | null>(null)
  const [isSshPreparing, setIsSshPreparing] = React.useState(false)
  const [isSshConfigWriting, setIsSshConfigWriting] = React.useState(false)
  const [isSshDependencyChecking, setIsSshDependencyChecking] =
    React.useState(false)
  const activeSshSandboxIdRef = React.useRef<string | null>(null)

  const showNotice = React.useCallback((message: string) => {
    toast.success(message)
  }, [])

  const loadData = React.useCallback(async () => {
    setError(null)
    setIsApiKeyLoading(true)

    try {
      const [nextStatus, apiKeyData] = await Promise.all([
        apiRequest<CodeBoxStatus>(
          "/api/codebox/status",
          undefined,
          t.requestFailed
        ),
        apiRequest<ModelverseApiKeysResponse>(
          "/api/studio/modelverse-api-keys",
          undefined,
          t.requestFailed
        ),
      ])
      const apiKeyConfigured = Boolean(apiKeyData.selected)

      setStatus({
        ...nextStatus,
        modelverseApiKey: {
          ...nextStatus.modelverseApiKey,
          configured: apiKeyConfigured,
          name: apiKeyData.selected?.name ?? null,
          projectId: apiKeyData.projectId,
        },
      })
      setApiKeys(apiKeyData.items)
      setSelectedApiKeyId(apiKeyData.selected?.id ?? "")

      if (!apiKeyConfigured) {
        setSandboxes([])
        return
      }

      const nextSandboxes = await apiRequest<CodeBoxSandbox[]>(
        `/api/codebox/sandboxes?state=${sandboxFilter}`,
        undefined,
        t.requestFailed
      )
      setSandboxes(nextSandboxes)
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : t.codeboxLoadFailed
      )
    } finally {
      setIsLoading(false)
      setIsApiKeyLoading(false)
    }
  }, [sandboxFilter, t])

  React.useEffect(() => {
    queueMicrotask(() => {
      void loadData()
    })
  }, [loadData])

  React.useEffect(() => {
    function handleProjectChanged() {
      setIsLoading(true)
      setSelectedApiKeyId("")
      void loadData()
    }

    window.addEventListener(UCLOUD_PROJECT_CHANGED_EVENT, handleProjectChanged)

    return () => {
      window.removeEventListener(
        UCLOUD_PROJECT_CHANGED_EVENT,
        handleProjectChanged
      )
    }
  }, [loadData])

  React.useEffect(() => {
    if (!githubFlow) {
      return
    }

    const activeFlow = githubFlow
    let cancelled = false
    let timer: number | undefined
    let nextIntervalSeconds = Math.max(3, activeFlow.interval)

    async function pollGithub() {
      try {
        const result = await apiRequest<GithubPollResult>(
          `/api/codebox/github/device/${activeFlow.flowId}/poll`,
          {
            method: "POST",
          },
          t.requestFailed
        )

        if (cancelled) {
          return
        }

        if (result.status === "pending") {
          if (result.interval) {
            nextIntervalSeconds = Math.max(3, result.interval)
          }

          setGithubMessage(t.codeboxWaitingGithub)
          timer = window.setTimeout(
            () => void pollGithub(),
            nextIntervalSeconds * 1000
          )
          return
        }

        if (result.status === "complete") {
          setStatus((current) =>
            current
              ? {
                  ...current,
                  github: result.github,
                }
              : current
          )
          setGithubMessage(t.codeboxGithubConnected)
          setGithubFlow(null)
          setGithubDialogOpen(false)
          showNotice(t.codeboxGithubInjected)
          void loadData()
          return
        }

        setGithubMessage(result.message ?? t.codeboxGithubStopped)
        setGithubFlow(null)
      } catch (pollError) {
        if (!cancelled) {
          setGithubMessage(
            pollError instanceof Error
              ? pollError.message
              : t.codeboxGithubFailed
          )
          setGithubFlow(null)
        }
      }
    }

    queueMicrotask(() => {
      setGithubMessage(t.codeboxWaitingGithub)
    })
    timer = window.setTimeout(
      () => void pollGithub(),
      nextIntervalSeconds * 1000
    )

    return () => {
      cancelled = true
      if (timer !== undefined) {
        window.clearTimeout(timer)
      }
    }
  }, [githubFlow, loadData, showNotice, t])

  async function refresh() {
    setIsLoading(true)
    await loadData()
  }

  async function selectApiKey(apiKeyId: string) {
    const normalizedApiKeyId = apiKeyId.trim()

    if (!normalizedApiKeyId || normalizedApiKeyId === "__empty") {
      return
    }

    setSelectedApiKeyId(normalizedApiKeyId)
    setBusyAction("save-api-key")
    setError(null)

    try {
      const saved = await apiRequest<SaveModelverseApiKeyResponse>(
        "/api/studio/modelverse-api-keys",
        {
          method: "POST",
          body: JSON.stringify({
            apiKeyId: normalizedApiKeyId,
          }),
        },
        t.requestFailed
      )

      showNotice(t.codeboxApiKeySelected(saved.selected.name))
      await loadData()
    } catch (selectError) {
      setError(
        selectError instanceof Error
          ? selectError.message
          : t.codeboxApiKeySelectFailed
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function createSandbox(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setBusyAction("create-sandbox")
    setError(null)

    try {
      const sandbox = await apiRequest<CodeBoxSandbox>(
        "/api/codebox/sandboxes",
        {
          method: "POST",
          body: JSON.stringify({
            name: sandboxName,
            repoUrl,
          }),
        },
        t.requestFailed
      )

      setSandboxes((current) => [sandbox, ...current])
      setSandboxName("")
      setRepoUrl("")
      const passwordCopied = await copyText(sandbox.password)
      showNotice(t.codeboxSandboxReady(passwordCopied))
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : t.codeboxSandboxCreateFailed
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function runSandboxAction(
    sandbox: CodeBoxSandbox,
    action: "pause" | "resume" | "kill"
  ) {
    setBusyAction(`${action}:${sandbox.sandboxId}`)
    setError(null)

    try {
      await apiRequest<{ sandboxId: string }>(
        `/api/codebox/sandboxes/${sandbox.sandboxId}/${action}`,
        {
          method: "POST",
        },
        t.requestFailed
      )
      await loadData()
      showNotice(t.codeboxSandboxActionCompleted(action))
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t.codeboxSandboxActionFailed(action)
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSandboxAction(
    sandbox: CodeBoxSandbox,
    action: "pause" | "resume" | "kill"
  ) {
    if (action === "kill") {
      setConfirmSandboxId("")
      setConfirmAction({ kind: "sandbox", sandbox })
      return
    }

    await runSandboxAction(sandbox, action)
  }

  function openRenameSandbox(sandbox: CodeBoxSandbox) {
    setEditingSandbox(sandbox)
    setEditingSandboxName(sandbox.name ?? "")
  }

  function openWorkspaceDialog(sandbox: CodeBoxSandbox) {
    setWorkspaceSandbox(sandbox)
    setWorkspacePath(
      sandbox.workspacePath ||
        status?.workspacePath ||
        DEFAULT_CODEBOX_WORKSPACE_PATH
    )
  }

  function openSandboxWorkspace(path: string) {
    const sandbox = workspaceSandbox

    if (!sandbox) {
      return
    }

    try {
      const url = createWorkspaceUrl(sandbox, path)
      const opened = window.open(url, "_blank", "noopener,noreferrer")

      if (opened) {
        opened.opener = null
      }

      setWorkspaceSandbox(null)
      setWorkspacePath(DEFAULT_CODEBOX_WORKSPACE_PATH)
    } catch {
      setError(t.codeboxOpenFailed)
    }
  }

  function getSandboxWorkspacePath(sandbox: CodeBoxSandbox) {
    return (
      sandbox.workspacePath || status?.workspacePath || DEFAULT_CODEBOX_WORKSPACE_PATH
    )
  }

  async function requestSandboxSshAccess(
    sandbox: CodeBoxSandbox,
    options: {
      prepareRemote?: boolean
      writeConfig?: boolean
    } = {}
  ) {
    return apiRequest<CodeBoxSshAccess>(
      `/api/codebox/sandboxes/${encodeURIComponent(sandbox.sandboxId)}/ssh`,
      {
        method: "POST",
        body: JSON.stringify({
          prepareRemote: options.prepareRemote ?? false,
          writeConfig: options.writeConfig ?? false,
          workspacePath: getSandboxWorkspacePath(sandbox),
        }),
      },
      t.codeboxSshPrepareFailed
    )
  }

  async function prepareSandboxVSCode(sandbox: CodeBoxSandbox) {
    activeSshSandboxIdRef.current = sandbox.sandboxId
    setSshSandbox(sandbox)
    setSshAccess(null)
    setLocalDependencies(null)
    setSshError(null)
    setIsSshConfigWriting(false)
    setIsSshDependencyChecking(true)

    try {
      const dependencies = await apiRequest<CodeBoxLocalDependencyStatus>(
        "/api/codebox/local-dependencies",
        undefined,
        t.codeboxSshDependencyCheckFailed
      )

      if (activeSshSandboxIdRef.current !== sandbox.sandboxId) {
        return
      }

      setLocalDependencies(dependencies)

      if (!dependencies.websocat.installed) {
        return
      }
    } catch (dependencyError) {
      if (activeSshSandboxIdRef.current === sandbox.sandboxId) {
        setSshError(
          dependencyError instanceof Error
            ? dependencyError.message
            : t.codeboxSshDependencyCheckFailed
        )
      }
      return
    } finally {
      if (activeSshSandboxIdRef.current === sandbox.sandboxId) {
        setIsSshDependencyChecking(false)
      }
    }

    setIsSshPreparing(true)
    try {
      const access = await requestSandboxSshAccess(sandbox)

      if (activeSshSandboxIdRef.current !== sandbox.sandboxId) {
        return
      }

      setSshAccess(access)

      const preparedAccess = await requestSandboxSshAccess(sandbox, {
        prepareRemote: true,
      })

      if (activeSshSandboxIdRef.current !== sandbox.sandboxId) {
        return
      }

      setSshAccess((current) =>
        current?.sandboxId === preparedAccess.sandboxId
          ? {
              ...preparedAccess,
              sshConfigPath:
                current.sshConfigPath ?? preparedAccess.sshConfigPath,
            }
          : current
      )
      showNotice(t.codeboxSshReady)
    } catch (sshPrepareError) {
      if (activeSshSandboxIdRef.current === sandbox.sandboxId) {
        setSshError(
          sshPrepareError instanceof Error
            ? sshPrepareError.message
            : t.codeboxSshPrepareFailed
        )
      }
    } finally {
      if (activeSshSandboxIdRef.current === sandbox.sandboxId) {
        setIsSshPreparing(false)
      }
    }
  }

  async function writeSandboxSshConfig() {
    const sandbox = sshSandbox

    if (!sandbox) {
      return
    }

    setIsSshConfigWriting(true)
    setSshError(null)

    try {
      const access = await requestSandboxSshAccess(sandbox, {
        writeConfig: true,
      })

      if (activeSshSandboxIdRef.current !== sandbox.sandboxId) {
        return
      }

      setSshAccess((current) =>
        current?.sandboxId === access.sandboxId
          ? {
              ...access,
              remoteReady: current.remoteReady || access.remoteReady,
            }
          : access
      )

      if (access.sshConfigPath) {
        showNotice(t.codeboxSshConfigInstalled(access.sshConfigPath))
      }
    } catch (writeError) {
      if (activeSshSandboxIdRef.current === sandbox.sandboxId) {
        setSshError(
          writeError instanceof Error
            ? writeError.message
            : t.codeboxSshConfigWriteFailed
        )
      }
    } finally {
      if (activeSshSandboxIdRef.current === sandbox.sandboxId) {
        setIsSshConfigWriting(false)
      }
    }
  }

  function openVSCode(access: CodeBoxSshAccess) {
    const opened = window.open(
      access.vscodeUri,
      "_blank",
      "noopener,noreferrer"
    )

    if (opened) {
      opened.opener = null
    }
  }

  async function saveSandboxName() {
    const sandbox = editingSandbox

    if (!sandbox) {
      return
    }

    setBusyAction(`rename:${sandbox.sandboxId}`)
    setError(null)

    try {
      const updated = await apiRequest<CodeBoxSandbox>(
        `/api/codebox/sandboxes/${encodeURIComponent(sandbox.sandboxId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: editingSandboxName,
          }),
        },
        t.requestFailed
      )

      setSandboxes((current) =>
        current.map((item) =>
          item.sandboxId === updated.sandboxId ? updated : item
        )
      )
      setEditingSandbox(null)
      setEditingSandboxName("")
      showNotice(t.codeboxSandboxNameUpdated)
    } catch (renameError) {
      setError(
        renameError instanceof Error
          ? renameError.message
          : t.codeboxSandboxNameUpdateFailed
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function confirmDestructiveAction() {
    const action = confirmAction

    if (!action) {
      return
    }

    setConfirmAction(null)
    setConfirmSandboxId("")

    await runSandboxAction(action.sandbox, "kill")
  }

  async function startGithubLogin() {
    setBusyAction("github-login")
    setError(null)
    setGithubMessage("")

    try {
      const flow = await apiRequest<GithubDeviceFlow>(
        "/api/codebox/github/device",
        {
          method: "POST",
        },
        t.requestFailed
      )

      setGithubFlow(flow)
      setGithubDialogOpen(true)
      setGithubMessage(t.codeboxWaitingGithub)
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : t.codeboxGithubLoginFailed
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function logoutGithub() {
    setBusyAction("github-logout")
    setError(null)

    try {
      const github = await apiRequest<CodeBoxGithubStatus>(
        "/api/codebox/github/logout",
        {
          method: "POST",
        },
        t.requestFailed
      )

      setStatus((current) =>
        current
          ? {
              ...current,
              github,
            }
          : current
      )
      showNotice(t.codeboxGithubRemoved)
    } catch (logoutError) {
      setError(
        logoutError instanceof Error
          ? logoutError.message
          : t.codeboxGithubLogoutFailed
      )
    } finally {
      setBusyAction(null)
    }
  }

  async function copyText(value: string | null | undefined) {
    if (!value) {
      return false
    }

    return writeClipboard(value)
  }

  return (
    <main className="flex h-full max-h-full min-h-0 flex-col overflow-hidden bg-background">
      <section className="flex min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-6">
        <div className="flex min-h-0 w-full flex-1 flex-col gap-3 overflow-hidden">
          {error ? (
            <Alert variant="destructive" className="shrink-0">
              <RiInformationLine />
              <AlertTitle>{t.codeboxAttentionTitle}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
            <div className="shrink-0">
              <Panel
                title={t.codeboxNewSandboxTitle}
                description={t.codeboxUsesHomeWorkspace(status?.workspacePath)}
                icon={<RiTerminalBoxLine className="size-4" aria-hidden />}
                className="shrink-0"
              >
                <p className="mb-3 text-xs text-muted-foreground">
                  {t.codeboxNewSandboxDescription}
                </p>
                <form
                  className="grid gap-3 lg:grid-cols-[minmax(0,0.65fr)_minmax(0,0.65fr)_minmax(0,1.2fr)_auto]"
                  onSubmit={createSandbox}
                >
                  <Select
                    value={selectedApiKeyId}
                    onValueChange={(value) => {
                      const nextValue = value.trim()

                      if (nextValue && nextValue !== "__empty") {
                        void selectApiKey(nextValue)
                      }
                    }}
                    disabled={
                      isApiKeyLoading ||
                      busyAction === "save-api-key"
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={
                          isApiKeyLoading
                            ? t.codeboxLoadingApiKeys
                            : t.codeboxApiKey
                        }
                      />
                    </SelectTrigger>
                    <SelectContent
                      align="start"
                      className="max-h-80"
                      position="popper"
                    >
                      <SelectGroup>
                        {apiKeys.length === 0 ? (
                          <SelectItem value="__empty" disabled>
                            {t.codeboxNoApiKeys}
                          </SelectItem>
                        ) : (
                          apiKeys.map((apiKey) => (
                            <SelectItem key={apiKey.id} value={apiKey.id}>
                              {apiKey.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectGroup>
                    </SelectContent>
                  </Select>

                  <Input
                    value={sandboxName}
                    onChange={(event) => setSandboxName(event.target.value)}
                    placeholder={t.codeboxSandboxNamePlaceholder}
                    className="h-9"
                    maxLength={64}
                  />

                  <Input
                    type="url"
                    value={repoUrl}
                    onChange={(event) => setRepoUrl(event.target.value)}
                    placeholder={t.codeboxRepoPlaceholder}
                    className="h-9"
                  />

                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      busyAction === "create-sandbox" ||
                      busyAction === "save-api-key" ||
                      !selectedApiKeyId
                    }
                  >
                    {busyAction === "create-sandbox" ? (
                      <RiLoader4Line className="animate-spin" />
                    ) : (
                      <RiPlayLine />
                    )}
                    {t.codeboxLaunch}
                  </Button>
                </form>
              </Panel>
            </div>

            <Panel
              title={t.codeboxSandboxesTitle}
              description={t.codeboxSandboxesShown(sandboxes.length)}
              icon={<RiCodeBoxLine className="size-4" aria-hidden />}
              className="flex min-h-0 flex-1 flex-col"
              bodyClassName="min-h-0 flex-1"
              action={
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => void refresh()}
                    disabled={isLoading}
                    aria-label={t.codeboxRefreshSandboxes}
                  >
                    <RiRefreshLine
                      className={cn(isLoading && "animate-spin")}
                    />
                  </Button>
                  <Select
                    value={sandboxFilter}
                    onValueChange={(value) =>
                      setSandboxFilter(value as SandboxFilter)
                    }
                  >
                    <SelectTrigger size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="all">
                          {t.codeboxFilterAll}
                        </SelectItem>
                        <SelectItem value="running">
                          {t.codeboxFilterRunning}
                        </SelectItem>
                        <SelectItem value="paused">
                          {t.codeboxFilterPaused}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              }
            >
              <div className="flex max-h-full min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                {isLoading && sandboxes.length === 0 ? (
                  <LoadingBlock />
                ) : status && !status.modelverseApiKey.configured ? (
                  <ApiKeyRequiredBlock />
                ) : sandboxes.length === 0 ? (
                  <EmptyBlock text={t.codeboxNoSandboxes} />
                ) : (
                  sandboxes.map((sandbox) => (
                    <SandboxItem
                      key={sandbox.sandboxId}
                      sandbox={sandbox}
                      busyAction={busyAction}
                      sshBusy={
                        (isSshPreparing || isSshDependencyChecking) &&
                        sshSandbox?.sandboxId === sandbox.sandboxId
                      }
                      onCopy={copyText}
                      onAction={handleSandboxAction}
                      onRename={openRenameSandbox}
                      onOpenWorkspace={openWorkspaceDialog}
                      onOpenVSCode={(item) => void prepareSandboxVSCode(item)}
                    />
                  ))
                )}
              </div>
            </Panel>

            <Panel
              title="GitHub"
              description={
                status?.github.configured
                  ? (status.github.login ?? t.codeboxGithubConnectedLabel)
                  : t.codeboxGithubDeviceFlow
              }
              icon={<RiGithubLine className="size-4" aria-hidden />}
              className="shrink-0"
              action={
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    size="sm"
                    onClick={() => void startGithubLogin()}
                    disabled={busyAction === "github-login"}
                  >
                    {busyAction === "github-login" ? (
                      <RiLoader4Line className="animate-spin" />
                    ) : (
                      <RiGithubLine />
                    )}
                    {status?.github.configured
                      ? t.codeboxReconnect
                      : t.codeboxConnect}
                  </Button>
                  {status?.github.configured ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void logoutGithub()}
                      disabled={busyAction === "github-logout"}
                    >
                      <RiCloseLine />
                      {t.logout}
                    </Button>
                  ) : null}
                </div>
              }
            >
              {null}
            </Panel>
          </div>
        </div>
      </section>

      <GithubDeviceDialog
        open={githubDialogOpen}
        onOpenChange={setGithubDialogOpen}
        flow={githubFlow}
        message={githubMessage}
        onCopy={copyText}
      />
      <ConfirmActionDialog
        action={confirmAction}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmSandboxId("")
            setConfirmAction(null)
          }
        }}
        confirmSandboxId={confirmSandboxId}
        onConfirmSandboxIdChange={setConfirmSandboxId}
        onConfirm={() => void confirmDestructiveAction()}
      />
      <RenameSandboxDialog
        sandbox={editingSandbox}
        value={editingSandboxName}
        busy={Boolean(
          editingSandbox &&
            busyAction === `rename:${editingSandbox.sandboxId}`
        )}
        onValueChange={setEditingSandboxName}
        onOpenChange={(open) => {
          if (!open) {
            setEditingSandbox(null)
            setEditingSandboxName("")
          }
        }}
        onSave={() => void saveSandboxName()}
      />
      <WorkspaceDirectoryDialog
        key={workspaceSandbox?.sandboxId ?? "workspace-directory-dialog"}
        sandbox={workspaceSandbox}
        value={workspacePath}
        defaultPath={status?.workspacePath || DEFAULT_CODEBOX_WORKSPACE_PATH}
        onValueChange={setWorkspacePath}
        onOpenChange={(open) => {
          if (!open) {
            setWorkspaceSandbox(null)
            setWorkspacePath(DEFAULT_CODEBOX_WORKSPACE_PATH)
          }
        }}
        onOpen={openSandboxWorkspace}
      />
      <OpenVSCodeDialog
        sandbox={sshSandbox}
        access={sshAccess}
        localDependencies={localDependencies}
        busy={isSshPreparing}
        configWriting={isSshConfigWriting}
        checkingDependencies={isSshDependencyChecking}
        error={sshError}
        onCopy={copyText}
        onRetry={() => {
          if (sshSandbox) {
            void prepareSandboxVSCode(sshSandbox)
          }
        }}
        onWriteConfig={() => void writeSandboxSshConfig()}
        onOpenVSCode={openVSCode}
        onOpenChange={(open) => {
          if (!open) {
            activeSshSandboxIdRef.current = null
            setSshSandbox(null)
            setSshAccess(null)
            setLocalDependencies(null)
            setSshError(null)
            setIsSshPreparing(false)
            setIsSshConfigWriting(false)
            setIsSshDependencyChecking(false)
          }
        }}
      />
    </main>
  )
}

function Panel({
  title,
  description,
  icon,
  action,
  className,
  bodyClassName,
  children,
}: {
  title: string
  description?: string
  icon: React.ReactNode
  action?: React.ReactNode
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  const hasBody = React.Children.count(children) > 0

  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-2xl border bg-card p-4 text-card-foreground shadow-sm",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-3",
          hasBody && "mb-3"
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            {description ? (
              <p className="truncate text-xs text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {action}
      </div>
      {hasBody ? <div className={bodyClassName}>{children}</div> : null}
    </section>
  )
}

function SandboxItem({
  sandbox,
  busyAction,
  sshBusy,
  onCopy,
  onAction,
  onRename,
  onOpenWorkspace,
  onOpenVSCode,
}: {
  sandbox: CodeBoxSandbox
  busyAction: string | null
  sshBusy: boolean
  onCopy: (value: string | null | undefined) => Promise<boolean>
  onAction: (
    sandbox: CodeBoxSandbox,
    action: "pause" | "resume" | "kill"
  ) => Promise<void>
  onRename: (sandbox: CodeBoxSandbox) => void
  onOpenWorkspace: (sandbox: CodeBoxSandbox) => void
  onOpenVSCode: (sandbox: CodeBoxSandbox) => void
}) {
  const { t } = useI18n()
  const statusLabel = getSandboxStatusLabel(sandbox.status, t)
  const isPaused = sandbox.status === "paused"
  const isRunning = sandbox.status === "running"
  const isRenaming = busyAction === `rename:${sandbox.sandboxId}`

  return (
    <article className="rounded-2xl border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 pl-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="max-w-[220px] truncate text-sm font-semibold">
              {sandbox.name ||
                (sandbox.repoUrl
                  ? getRepoName(sandbox.repoUrl)
                  : sandbox.sandboxId)}
            </h3>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="-ml-1 text-muted-foreground"
              onClick={() => onRename(sandbox)}
              disabled={isRenaming}
              aria-label={t.codeboxRenameSandbox}
            >
              {isRenaming ? (
                <RiLoader4Line className="animate-spin" />
              ) : (
                <RiEditLine />
              )}
            </Button>
            <Badge
              variant={
                isRunning ? "default" : isPaused ? "secondary" : "outline"
              }
            >
              {statusLabel}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {(isRunning || isPaused) && sandbox.codeServerUrl ? (
            <Button
              type="button"
              size="sm"
              onClick={() => onOpenWorkspace(sandbox)}
            >
              {t.codeboxOpen}
              <RiArrowRightUpLine />
            </Button>
          ) : null}
          {isRunning || isPaused ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenVSCode(sandbox)}
              disabled={sshBusy}
              aria-label={t.codeboxOpenVSCodeAria}
            >
              {sshBusy ? (
                <RiLoader4Line className="animate-spin" />
              ) : (
                <VSCodeIcon className="size-4" />
              )}
              {t.codeboxOpenVSCode}
            </Button>
          ) : null}
          {isRunning ? (
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => void onAction(sandbox, "pause")}
              disabled={busyAction === `pause:${sandbox.sandboxId}`}
              aria-label={t.codeboxPauseSandbox}
            >
              {busyAction === `pause:${sandbox.sandboxId}` ? (
                <RiLoader4Line className="animate-spin" />
              ) : (
                <RiPauseLine />
              )}
            </Button>
          ) : null}
          {isPaused ? (
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => void onAction(sandbox, "resume")}
              disabled={busyAction === `resume:${sandbox.sandboxId}`}
              aria-label={t.codeboxResumeSandbox}
            >
              {busyAction === `resume:${sandbox.sandboxId}` ? (
                <RiLoader4Line className="animate-spin" />
              ) : (
                <RiRestartLine />
              )}
            </Button>
          ) : null}
          <Button
            variant="destructive"
            size="icon-sm"
            onClick={() => void onAction(sandbox, "kill")}
            disabled={busyAction === `kill:${sandbox.sandboxId}`}
            aria-label={t.codeboxKillSandbox}
          >
            {busyAction === `kill:${sandbox.sandboxId}` ? (
              <RiLoader4Line className="animate-spin" />
            ) : (
              <RiDeleteBin6Line />
            )}
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
        <CopyLine
          label={t.codeboxUrl}
          value={sandbox.codeServerUrl ?? "-"}
          onCopy={() => onCopy(sandbox.codeServerUrl)}
        />
        <CopyLine
          label={t.codeboxPassword}
          value={sandbox.password ?? "-"}
          onCopy={() => onCopy(sandbox.password)}
        />
        <InfoLine label={t.codeboxWorkspace} value={sandbox.workspacePath} />
        <InfoLine label={t.codeboxRepo} value={sandbox.repoUrl ?? "-"} />
      </div>
    </article>
  )
}

function CopyLine({
  label,
  value,
  onCopy,
}: {
  label: string
  value: string
  onCopy: () => Promise<boolean>
}) {
  const [copied, setCopied] = React.useState(false)
  const { t } = useI18n()

  React.useEffect(() => {
    if (!copied) {
      return
    }

    const timeout = window.setTimeout(() => setCopied(false), 1200)

    return () => window.clearTimeout(timeout)
  }, [copied])

  async function handleCopy() {
    setCopied(await onCopy())
  }

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/50 py-1.5 pl-3 pr-2">
      <span className="shrink-0 font-medium text-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate">{value}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => void handleCopy()}
        disabled={value === "-"}
        aria-label={t.codeboxCopyLabel(label)}
      >
        {copied ? <RiCheckLine /> : <RiFileCopyLine />}
      </Button>
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/50 px-3 py-1.5">
      <span className="shrink-0 font-medium text-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate">{value}</span>
    </div>
  )
}

function LoadingBlock() {
  const { t } = useI18n()

  return (
    <div className="flex min-h-32 items-center justify-center rounded-2xl border bg-background text-sm text-muted-foreground">
      <RiLoader4Line className="mr-2 size-4 animate-spin" aria-hidden />
      {t.codeboxLoading}
    </div>
  )
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-2xl border bg-background px-4 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}

function ApiKeyRequiredBlock() {
  const { t } = useI18n()

  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed bg-background px-4 py-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
        <RiInformationLine className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-medium">{t.codeboxApiKeyRequiredTitle}</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        {t.codeboxApiKeyRequiredDescription}
      </p>
    </div>
  )
}

function GithubDeviceDialog({
  open,
  onOpenChange,
  flow,
  message,
  onCopy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  flow: GithubDeviceFlow | null
  message: string
  onCopy: (value: string | null | undefined) => Promise<boolean>
}) {
  const { locale, t } = useI18n()
  const [copyState, setCopyState] = React.useState<{
    userCode: string | null
    status: "idle" | "copied" | "blocked"
  }>({
    userCode: null,
    status: "idle",
  })
  const activeCopyStatus =
    open && copyState.userCode === flow?.userCode ? copyState.status : "idle"

  async function handleCopyCode() {
    if (!flow?.userCode) {
      return
    }

    setCopyState({
      userCode: flow.userCode,
      status: (await onCopy(flow.userCode)) ? "copied" : "blocked",
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.codeboxConnectGithubTitle}</DialogTitle>
          <DialogDescription>
            {t.codeboxConnectGithubDescription}
          </DialogDescription>
        </DialogHeader>

        {flow ? (
          <div className="grid gap-3">
            <div className="rounded-2xl border bg-background p-4 text-center">
              <div className="text-xs font-medium text-muted-foreground uppercase">
                {t.codeboxDeviceCode}
              </div>
              <div className="mt-2 font-mono text-2xl font-semibold tracking-normal">
                {flow.userCode}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void handleCopyCode()}
              >
                {activeCopyStatus === "copied" ? (
                  <RiCheckLine />
                ) : (
                  <RiFileCopyLine />
                )}
                {activeCopyStatus === "copied" ? t.copied : t.codeboxCopyCode}
              </Button>
              {activeCopyStatus === "blocked" ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t.codeboxCopyBlocked}
                </p>
              ) : null}
            </div>

            <Button asChild>
              <a href={flow.verificationUri} target="_blank" rel="noreferrer">
                {t.codeboxOpenGithub}
                <RiArrowRightUpLine />
              </a>
            </Button>

            <p className="text-sm text-muted-foreground">
              {message ||
                t.codeboxExpiresAt(formatDate(flow.expiresAt, locale))}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {message || t.codeboxNoActiveGithubFlow}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ConfirmActionDialog({
  action,
  onOpenChange,
  confirmSandboxId,
  onConfirmSandboxIdChange,
  onConfirm,
}: {
  action: ConfirmAction | null
  onOpenChange: (open: boolean) => void
  confirmSandboxId: string
  onConfirmSandboxIdChange: (value: string) => void
  onConfirm: () => void
}) {
  const { t } = useI18n()
  const target = action?.sandbox.repoUrl
    ? getRepoName(action.sandbox.repoUrl)
    : (action?.sandbox.sandboxId ?? "")
  const expectedSandboxId = action?.sandbox.sandboxId ?? ""
  const canConfirm =
    Boolean(expectedSandboxId) && confirmSandboxId.trim() === expectedSandboxId

  return (
    <Dialog open={Boolean(action)} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 rounded-3xl">
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <RiDeleteBin6Line className="size-5" aria-hidden />
          </div>
          <DialogTitle>{t.codeboxKillSandboxTitle}</DialogTitle>
          <DialogDescription>
            {t.codeboxKillSandboxConfirm(target)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="codebox-kill-confirm">
            {t.codeboxConfirmSandboxIdLabel}
          </label>
          <Input
            id="codebox-kill-confirm"
            value={confirmSandboxId}
            onChange={(event) =>
              onConfirmSandboxIdChange(event.target.value)
            }
            placeholder={expectedSandboxId}
            autoComplete="off"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.codeboxCancel}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            <RiDeleteBin6Line />
            {t.codeboxKill}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RenameSandboxDialog({
  sandbox,
  value,
  busy,
  onValueChange,
  onOpenChange,
  onSave,
}: {
  sandbox: CodeBoxSandbox | null
  value: string
  busy: boolean
  onValueChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onSave: () => void
}) {
  const { t } = useI18n()
  const fallbackName = sandbox?.repoUrl
    ? getRepoName(sandbox.repoUrl)
    : (sandbox?.sandboxId ?? "")

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSave()
  }

  return (
    <Dialog open={Boolean(sandbox)} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 rounded-3xl">
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
            <RiEditLine className="size-5" aria-hidden />
          </div>
          <DialogTitle>{t.codeboxRenameSandboxTitle}</DialogTitle>
          <DialogDescription>
            {t.codeboxRenameSandboxDescription}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="codebox-rename">
              {t.codeboxSandboxNamePlaceholder}
            </label>
            <Input
              id="codebox-rename"
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              placeholder={fallbackName}
              maxLength={64}
              autoComplete="off"
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t.codeboxCancel}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <RiLoader4Line className="animate-spin" /> : <RiCheckLine />}
              {t.studioSave}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type WebsocatInstallOption = {
  key: string
  label: string
  value: string
  note: string
}

type WebsocatInstallTabKey =
  | "linux"
  | "darwin"
  | "freebsd"
  | "source"
  | "prebuilt"

type WebsocatInstallGroup = {
  key: WebsocatInstallTabKey
  label: string
  options: WebsocatInstallOption[]
}

function getDefaultWebsocatInstallTab(
  platform: CodeBoxLocalDependencyStatus["platform"] | undefined
): WebsocatInstallTabKey {
  if (platform === "darwin" || platform === "freebsd" || platform === "linux") {
    return platform
  }

  return "prebuilt"
}

function getWebsocatInstallGroups(
  t: ReturnType<typeof useI18n>["t"]
): WebsocatInstallGroup[] {
  return [
    {
      key: "linux",
      label: t.codeboxSshInstallDebian,
      options: [
        {
          key: "debian",
          label: t.codeboxSshInstallDebian,
          value: [
            "sudo curl -fsSL -o /usr/local/bin/websocat https://github.com/vi/websocat/releases/latest/download/websocat.x86_64-unknown-linux-musl",
            "sudo chmod a+x /usr/local/bin/websocat",
          ].join("\n"),
          note: t.codeboxSshInstallDebianNote,
        },
      ],
    },
    {
      key: "darwin",
      label: "macOS",
      options: [
        {
          key: "homebrew",
          label: t.codeboxSshInstallMacHomebrew,
          value: "brew install websocat",
          note: t.codeboxSshInstallMacHomebrewNote,
        },
        {
          key: "macports",
          label: t.codeboxSshInstallMacPorts,
          value: "sudo port install websocat",
          note: t.codeboxSshInstallMacPortsNote,
        },
      ],
    },
    {
      key: "freebsd",
      label: t.codeboxSshInstallFreebsd,
      options: [
        {
          key: "freebsd",
          label: t.codeboxSshInstallFreebsd,
          value: "pkg install websocat",
          note: t.codeboxSshInstallFreebsdNote,
        },
      ],
    },
    {
      key: "source",
      label: t.codeboxSshInstallSource,
      options: [
        {
          key: "source",
          label: t.codeboxSshInstallSource,
          value: "cargo install websocat",
          note: t.codeboxSshInstallSourceNote,
        },
      ],
    },
    {
      key: "prebuilt",
      label: t.codeboxSshInstallPrebuilt,
      options: [
        {
          key: "prebuilt",
          label: t.codeboxSshInstallPrebuilt,
          value: "https://github.com/vi/websocat/releases/latest",
          note: t.codeboxSshInstallPrebuiltNote,
        },
      ],
    },
  ]
}

function OpenVSCodeDialog({
  sandbox,
  access,
  localDependencies,
  busy,
  configWriting,
  checkingDependencies,
  error,
  onCopy,
  onRetry,
  onWriteConfig,
  onOpenVSCode,
  onOpenChange,
}: {
  sandbox: CodeBoxSandbox | null
  access: CodeBoxSshAccess | null
  localDependencies: CodeBoxLocalDependencyStatus | null
  busy: boolean
  configWriting: boolean
  checkingDependencies: boolean
  error: string | null
  onCopy: (value: string | null | undefined) => Promise<boolean>
  onRetry: () => void
  onWriteConfig: () => void
  onOpenVSCode: (access: CodeBoxSshAccess) => void
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null)
  const [installTab, setInstallTab] =
    React.useState<WebsocatInstallTabKey | null>(null)
  const sandboxLabel =
    sandbox?.name ||
    (sandbox?.repoUrl ? getRepoName(sandbox.repoUrl) : sandbox?.sandboxId) ||
    ""
  const isWebsocatMissing = Boolean(
    localDependencies && !localDependencies.websocat.installed
  )
  const installGroups = React.useMemo(() => getWebsocatInstallGroups(t), [t])
  const defaultInstallTab = getDefaultWebsocatInstallTab(
    localDependencies?.platform
  )
  const activeInstallTab = installTab ?? defaultInstallTab
  const activeInstallGroup = installGroups.find(
    (group) => group.key === activeInstallTab
  )
  const activeInstallOptions = activeInstallGroup?.options ?? []
  const canOpenVSCode = Boolean(
    access?.sshConfigPath && access.remoteReady && !busy && !configWriting
  )
  const orderedInstallGroups = React.useMemo(
    () =>
      [...installGroups].sort((a, b) => {
        if (a.key === defaultInstallTab && b.key !== defaultInstallTab) {
          return -1
        }

        if (a.key !== defaultInstallTab && b.key === defaultInstallTab) {
          return 1
        }

        return 0
      }),
    [defaultInstallTab, installGroups]
  )

  React.useEffect(() => {
    if (!copiedKey) {
      return
    }

    const timeout = window.setTimeout(() => setCopiedKey(null), 1200)

    return () => window.clearTimeout(timeout)
  }, [copiedKey])

  async function copyValue(key: string, value: string | null | undefined) {
    setCopiedKey((await onCopy(value)) ? key : null)
  }

  return (
    <Dialog open={Boolean(sandbox)} onOpenChange={onOpenChange}>
      <DialogContent
        className="grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-3xl max-w-none gap-5 sm:max-w-none"
        style={{
          width: "min(1280px, calc(100vw - 2rem))",
          maxHeight: "calc(100vh - 2rem)",
        }}
      >
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
            <VSCodeIcon className="size-5" />
          </div>
          <DialogTitle>{t.codeboxSshPrepareTitle}</DialogTitle>
          <DialogDescription>
            {sandboxLabel
              ? t.codeboxSshPrepareDescription(sandboxLabel)
              : t.codeboxSshPrepareDescriptionFallback}
          </DialogDescription>
        </DialogHeader>

        {checkingDependencies || (busy && !access) ? (
          <div className="flex min-h-40 items-center justify-center gap-2 rounded-2xl border bg-background text-sm text-muted-foreground">
            <RiLoader4Line className="size-4 animate-spin" aria-hidden />
            {checkingDependencies
              ? t.codeboxSshCheckingDependencies
              : t.codeboxSshPreparing}
          </div>
        ) : error && !access ? (
          <Alert variant="destructive">
            <RiInformationLine />
            <AlertTitle>{t.codeboxAttentionTitle}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : isWebsocatMissing ? (
          <div className="grid min-h-0 gap-4 overflow-y-auto pr-1">
            <Alert>
              <RiInformationLine />
              <AlertTitle>{t.codeboxSshWebsocatMissingTitle}</AlertTitle>
              <AlertDescription>
                {t.codeboxSshWebsocatMissingDescription}
              </AlertDescription>
            </Alert>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">
                {t.codeboxSshDetectedPlatform(
                  localDependencies?.platform ?? "unknown"
                )}
              </Badge>
              <span>{t.codeboxSshInstallOptionsTitle}</span>
            </div>

            <div className="flex min-w-0 gap-1 overflow-x-auto rounded-2xl border bg-muted/50 p-1">
              {orderedInstallGroups.map((group) => (
                <Button
                  key={group.key}
                  type="button"
                  variant={activeInstallTab === group.key ? "secondary" : "ghost"}
                  size="sm"
                  className="shrink-0"
                  onClick={() => setInstallTab(group.key)}
                >
                  {group.label}
                  {group.key === defaultInstallTab ? (
                    <span className="ml-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                      {t.codeboxSshRecommended}
                    </span>
                  ) : null}
                </Button>
              ))}
            </div>

            <div className="grid gap-3">
              {activeInstallOptions.map((option) => (
                <div
                  key={option.key}
                  className="rounded-2xl border bg-background p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{option.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {option.note}
                      </p>
                    </div>
                    {activeInstallTab === defaultInstallTab ? (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      >
                        {t.codeboxSshRecommended}
                      </Badge>
                    ) : null}
                  </div>
                  <SshSnippet
                    label={t.codeboxSshInstallCommand}
                    value={option.value}
                    copied={copiedKey === option.key}
                    copyLabel={t.codeboxSshCopyInstallCommand}
                    onCopy={() => void copyValue(option.key, option.value)}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : access ? (
          <div className="grid min-h-0 gap-4 overflow-y-auto pr-1">
            <div className="rounded-2xl border bg-muted/40 p-3">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {access.hostAlias}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {access.sshConfigPath
                      ? t.codeboxSshConfigInstalled(access.sshConfigPath)
                      : t.codeboxSshConfigNeedsAuthorization}
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {busy && !access.remoteReady ? (
                      <RiLoader4Line className="size-3.5 animate-spin" />
                    ) : null}
                    {access.remoteReady
                      ? t.codeboxSshRemoteReady
                      : t.codeboxSshRemotePreparing}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Badge variant="secondary">SSH</Badge>
                  {!access.sshConfigPath ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={onWriteConfig}
                      disabled={configWriting}
                    >
                      {configWriting ? (
                        <RiLoader4Line className="animate-spin" />
                      ) : (
                        <RiFileCopyLine />
                      )}
                      {configWriting
                        ? t.codeboxSshWritingConfig
                        : t.codeboxSshWriteConfig}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>

            {error ? (
              <Alert variant="destructive">
                <RiInformationLine />
                <AlertTitle>{t.codeboxAttentionTitle}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {!access.sshConfigPath ? (
              <SshSnippet
                label={t.codeboxSshConfig}
                value={access.sshConfig}
                copied={copiedKey === "config"}
                copyLabel={t.codeboxSshCopyConfig}
                onCopy={() => void copyValue("config", access.sshConfig)}
              />
            ) : null}

            {access.remoteReady ? (
              <>
                <CopyLine
                  label={t.codeboxPassword}
                  value={access.password ?? "-"}
                  onCopy={() => onCopy(access.password)}
                />

                <SshSnippet
                  label={t.codeboxSshCommand}
                  value={access.sshCommand}
                  copied={copiedKey === "command"}
                  copyLabel={t.codeboxSshCopyCommand}
                  onCopy={() => void copyValue("command", access.sshCommand)}
                />
              </>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.codeboxCancel}
          </Button>
          {error || isWebsocatMissing ? (
            <Button onClick={onRetry}>
              <RiRefreshLine />
              {isWebsocatMissing ? t.codeboxSshCheckAgain : t.codeboxSshRetry}
            </Button>
          ) : (
            <Button
              onClick={() => {
                if (access) {
                  onOpenVSCode(access)
                }
              }}
              disabled={!canOpenVSCode || checkingDependencies}
            >
              {t.codeboxSshOpenVSCode}
              <RiArrowRightUpLine />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SshSnippet({
  label,
  value,
  copied,
  copyLabel,
  onCopy,
}: {
  label: string
  value: string
  copied: boolean
  copyLabel: string
  onCopy: () => void
}) {
  const { t } = useI18n()

  return (
    <div className="rounded-2xl border bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Button type="button" variant="ghost" size="sm" onClick={onCopy}>
          {copied ? <RiCheckLine /> : <RiFileCopyLine />}
          {copied ? t.copied : copyLabel}
        </Button>
      </div>
      <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-xs leading-relaxed text-muted-foreground">
        {value}
      </pre>
    </div>
  )
}

function WorkspaceDirectoryDialog({
  sandbox,
  value,
  defaultPath,
  onValueChange,
  onOpenChange,
  onOpen,
}: {
  sandbox: CodeBoxSandbox | null
  value: string
  defaultPath: string
  onValueChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onOpen: (path: string) => void
}) {
  const { t } = useI18n()
  const [error, setError] = React.useState<string | null>(null)
  const [directoryData, setDirectoryData] =
    React.useState<CodeBoxDirectoryList | null>(null)
  const [directoryError, setDirectoryError] = React.useState<string | null>(
    null
  )
  const [isDirectoryLoading, setIsDirectoryLoading] = React.useState(false)
  const quickPaths = React.useMemo(
    () =>
      Array.from(
        new Set(
          [
            sandbox?.workspacePath,
            defaultPath,
            DEFAULT_CODEBOX_WORKSPACE_PATH,
            "/root",
            "/tmp",
          ].filter((path): path is string => Boolean(path?.trim()))
        )
      ),
    [defaultPath, sandbox?.workspacePath]
  )

  const loadDirectory = React.useCallback(
    async (nextPath: string) => {
      if (!sandbox) {
        return
      }

      let normalizedPath: string

      try {
        normalizedPath = normalizeWorkspaceDirectoryPath(nextPath)
      } catch {
        setError(t.codeboxWorkspaceDirectoryInvalid)
        return
      }

      setIsDirectoryLoading(true)
      setDirectoryError(null)
      setError(null)

      try {
        const data = await apiRequest<CodeBoxDirectoryList>(
          `/api/codebox/sandboxes/${encodeURIComponent(
            sandbox.sandboxId
          )}/directories?path=${encodeURIComponent(normalizedPath)}`,
          undefined,
          t.codeboxWorkspaceDirectoryLoadFailed
        )

        setDirectoryData(data)
        onValueChange(data.path)
      } catch (loadError) {
        setDirectoryError(
          loadError instanceof Error
            ? loadError.message
            : t.codeboxWorkspaceDirectoryLoadFailed
        )
      } finally {
        setIsDirectoryLoading(false)
      }
    },
    [onValueChange, sandbox, t]
  )

  React.useEffect(() => {
    if (!sandbox) {
      return
    }

    queueMicrotask(() => {
      void loadDirectory(
        sandbox.workspacePath || defaultPath || DEFAULT_CODEBOX_WORKSPACE_PATH
      )
    })
  }, [defaultPath, loadDirectory, sandbox])

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = value.trim()

    if (!trimmed) {
      setError(t.codeboxWorkspaceDirectoryRequired)
      return
    }

    if (!trimmed.startsWith("/")) {
      setError(t.codeboxWorkspaceDirectoryAbsolute)
      return
    }

    try {
      const normalized = normalizeWorkspaceDirectoryPath(trimmed)

      setError(null)
      onValueChange(normalized)
      onOpen(normalized)
    } catch {
      setError(t.codeboxWorkspaceDirectoryInvalid)
    }
  }

  const currentDirectoryPath = directoryData?.path ?? value.trim()
  const parentDirectoryPath = directoryData?.parentPath ?? null

  return (
    <Dialog open={Boolean(sandbox)} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 rounded-3xl">
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
            <RiTerminalBoxLine className="size-5" aria-hidden />
          </div>
          <DialogTitle>{t.codeboxWorkspaceDirectoryTitle}</DialogTitle>
          <DialogDescription>
            {t.codeboxWorkspaceDirectoryDescription}
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <label
              className="text-sm font-medium"
              htmlFor="codebox-workspace-directory"
            >
              {t.codeboxWorkspaceDirectoryLabel}
            </label>
            <Input
              id="codebox-workspace-directory"
              value={value}
              onChange={(event) => {
                onValueChange(event.target.value)
                setError(null)
              }}
              placeholder={DEFAULT_CODEBOX_WORKSPACE_PATH}
              autoComplete="off"
              autoFocus
              aria-invalid={Boolean(error)}
            />
            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t.codeboxWorkspaceDirectoryHint}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">
                {t.codeboxWorkspaceDirectoryCurrent}
              </p>
              <div className="flex flex-wrap gap-2">
                {parentDirectoryPath ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void loadDirectory(parentDirectoryPath)}
                    disabled={isDirectoryLoading}
                  >
                    <RiArrowUpLine />
                    {t.codeboxWorkspaceDirectoryParent}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadDirectory(value)}
                  disabled={isDirectoryLoading}
                >
                  {isDirectoryLoading ? (
                    <RiLoader4Line className="animate-spin" />
                  ) : (
                    <RiRefreshLine />
                  )}
                  {t.codeboxWorkspaceDirectoryLoad}
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border bg-background">
              <div className="flex min-w-0 items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
                <RiFolderLine className="shrink-0" aria-hidden />
                <span className="truncate">
                  {currentDirectoryPath || DEFAULT_CODEBOX_WORKSPACE_PATH}
                </span>
              </div>
              <div className="flex max-h-52 min-h-28 flex-col overflow-y-auto p-1">
                {isDirectoryLoading ? (
                  <div className="flex flex-1 items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground">
                    <RiLoader4Line className="animate-spin" aria-hidden />
                    {t.codeboxWorkspaceDirectoryLoading}
                  </div>
                ) : directoryError ? (
                  <div className="flex flex-1 items-center justify-center px-3 py-8 text-center text-sm text-destructive">
                    {directoryError}
                  </div>
                ) : directoryData && directoryData.directories.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center px-3 py-8 text-center text-sm text-muted-foreground">
                    {t.codeboxWorkspaceDirectoryEmpty}
                  </div>
                ) : (
                  directoryData?.directories.map((directory) => (
                    <Button
                      key={directory.path}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto justify-start px-3 py-2"
                      onClick={() => void loadDirectory(directory.path)}
                    >
                      <RiFolderLine className="shrink-0" aria-hidden />
                      <span className="min-w-0 truncate">
                        {directory.name}
                      </span>
                    </Button>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t.codeboxWorkspaceDirectoryQuickPick}
            </p>
            <div className="flex flex-wrap gap-2">
              {quickPaths.map((path) => (
                <Button
                  key={path}
                  type="button"
                  variant={value.trim() === path ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => void loadDirectory(path)}
                >
                  {path}
                </Button>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t.codeboxCancel}
            </Button>
            <Button type="submit">
              {t.codeboxOpenWorkspace}
              <RiArrowRightUpLine />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { CodeBoxPage }
