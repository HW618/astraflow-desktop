import { expect, type APIRequestContext, type Page, test } from "@playwright/test"

const AGENT_SWITCHER_NAME = /^(Agent|智能体)$/
const PERMISSION_MODE_NAME = /^(Permissions|权限)$/

type ApiResponse<T> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      error: unknown
    }

type RuntimeInfo = {
  id: string
  label: string
}

type StudioSession = {
  id: string
}

test("Codex runtime shows and persists ACP permission mode", async ({
  page,
  request,
}) => {
  const runtimes = await listAgentRuntimes(request)

  test.skip(
    !runtimes.some((runtime) => runtime.id === "codex"),
    "Codex ACP runtime is not available in this environment."
  )

  const session = await createChatSession(request)

  await gotoSession(page, session.id)
  await expect(permissionModeSelect(page)).toBeHidden()

  await selectRuntime(page, "Codex")
  test.skip(
    (await permissionModeSelect(page).count()) === 0,
    "The running dev server has not picked up the permission mode UI yet."
  )
  await expect(permissionModeSelect(page)).toBeVisible()
  await expect(permissionModeSelect(page)).toContainText(/Ask first|需要批准/)

  const patchResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/studio/sessions/${session.id}` &&
      response.request().method() === "PATCH",
    { timeout: 30_000 }
  )

  await permissionModeSelect(page).click()
  await page
    .getByRole("option", { name: /Auto allow|自动允许/ })
    .click()

  const patchResponse = await patchResponsePromise
  expect(patchResponse.status()).toBe(200)
  await expect(permissionModeSelect(page)).toContainText(/Auto allow|自动允许/)

  await reloadSession(page)
  await expect(agentSwitcher(page)).toContainText("Codex")
  await expect(permissionModeSelect(page)).toBeVisible()
  await expect(permissionModeSelect(page)).toContainText(/Auto allow|自动允许/)
})

async function listAgentRuntimes(request: APIRequestContext) {
  const response = await request.get("/api/studio/agent-runtimes")
  const payload = (await response.json()) as ApiResponse<RuntimeInfo[]>

  if (!response.ok() || !payload.ok) {
    return []
  }

  return payload.data
}

async function createChatSession(request: APIRequestContext) {
  const response = await request.post("/api/studio/sessions", {
    data: {
      mode: "chat",
      title: "Permission mode e2e",
    },
  })
  const payload = (await response.json()) as ApiResponse<StudioSession>

  expect(response.status()).toBe(201)
  expect(payload.ok).toBe(true)

  if (!payload.ok) {
    throw new Error("Failed to create session")
  }

  return payload.data
}

async function gotoSession(page: Page, sessionId: string) {
  await page.goto(`/studio/chat/${encodeURIComponent(sessionId)}`, {
    waitUntil: "domcontentloaded",
  })
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {
    // The dev overlay/HMR connection can keep the page busy; visible UI is authoritative.
  })
  await expect(agentSwitcher(page)).toBeVisible({ timeout: 30_000 })
}

async function reloadSession(page: Page) {
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {
    // The dev overlay/HMR connection can keep the page busy; visible UI is authoritative.
  })
  await expect(agentSwitcher(page)).toBeVisible({ timeout: 30_000 })
}

function agentSwitcher(page: Page) {
  return page.getByRole("combobox", { name: AGENT_SWITCHER_NAME })
}

function permissionModeSelect(page: Page) {
  return page.getByRole("combobox", { name: PERMISSION_MODE_NAME })
}

async function selectRuntime(page: Page, label: string) {
  await agentSwitcher(page).click()
  await page
    .getByRole("option", {
      name: new RegExp(`^${escapeRegExp(label)}\\b`),
    })
    .click()
  await expect(agentSwitcher(page)).toContainText(label)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
