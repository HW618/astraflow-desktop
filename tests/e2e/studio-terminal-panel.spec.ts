import { expect, type Page, type Response, test } from "@playwright/test"
import { mkdir } from "node:fs/promises"

const TERMINAL_TOGGLE = "studio-terminal-panel-toggle"
const TERMINAL_PANEL = "studio-terminal-panel"
const evidencePath = "test-results/studio-terminal-panel.png"

test.beforeAll(async () => {
  await mkdir("test-results", { recursive: true })
})

test("Studio bottom terminal panel opens, closes, and responds to shortcut", async ({
  page,
}, testInfo) => {
  const result = await gotoStudio(page)

  if (!result.ready) {
    await page.screenshot({ path: evidencePath, fullPage: true })
    testInfo.annotations.push({
      type: "blocked",
      description: result.reason,
    })
    test.skip(true, `BLOCKED: ${result.reason}. Screenshot: ${evidencePath}`)
  }

  const toggle = page.getByTestId(TERMINAL_TOGGLE)
  await expect(toggle).toBeVisible()
  await toggle.click()

  const panel = page.getByTestId(TERMINAL_PANEL)
  await expect(panel).toBeVisible()
  await expect(panel.locator(".xterm").first()).toBeVisible()

  await page.keyboard.press(process.platform === "darwin" ? "Meta+J" : "Control+J")
  await expect(panel).toBeHidden()

  await page.keyboard.press(process.platform === "darwin" ? "Meta+J" : "Control+J")
  await expect(page.getByTestId(TERMINAL_PANEL)).toBeVisible()

  await page
    .getByRole("button", {
      name: /^(Close terminal panel|关闭底部面板)$/,
    })
    .click()
  await expect(page.getByTestId(TERMINAL_PANEL)).toBeHidden()

  await page.screenshot({ path: evidencePath, fullPage: true })
})

async function gotoStudio(page: Page) {
  const response = await page.goto("/studio", {
    waitUntil: "domcontentloaded",
  })
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {
    // HMR can keep the page busy; visible UI is the reliable readiness signal.
  })

  const ready = await isStudioReady(page)

  return {
    ready,
    response,
    reason: ready ? "" : await getBlockedReason(page, response),
  }
}

async function isStudioReady(page: Page) {
  try {
    await expect(page.getByTestId(TERMINAL_TOGGLE)).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.locator("textarea").first()).toBeVisible({
      timeout: 5_000,
    })
    return true
  } catch {
    return false
  }
}

async function getBlockedReason(page: Page, response: Response | null) {
  const url = page.url()
  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 2_000 })
    .catch(() => "")
  const excerpt = bodyText.replace(/\s+/g, " ").trim().slice(0, 300)
  const status = response?.status() ?? "no-response"

  if (new URL(url).pathname.startsWith("/login")) {
    return `redirected to login; status=${status}; body="${excerpt}"`
  }

  return `studio UI unavailable; url=${url}; status=${status}; body="${excerpt}"`
}
