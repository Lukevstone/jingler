/** Side chat (Claude Code's /btw): answers and follows up beside the chat, never enters it, wipes on close. */
import { appShell, expect, test } from "./fixtures.js"
import type { SeedSession } from "./fixtures.js"

const session: SeedSession = {
  id: "s_side_chat",
  repo: "widget",
  branch: "feat/side-chat",
  title: "Side chat test",
  status: "idle",
  diff: { added: 0, removed: 0 },
  prNumber: null,
  costUsd: 0,
  tokens: 0,
  updatedAt: "2026-11-03T10:00:00.000Z"
}

test("side chat answers, follows up, leaves the main transcript alone and clears on close", async ({ launchApp }) => {
  const { window } = await launchApp({
    configured: true,
    withRepo: true,
    sessions: (context) => [{ ...session, worktreePath: context.repoPath }]
  })
  await window.setViewportSize({ width: 1600, height: 900 })
  await expect(appShell(window)).toBeVisible()
  await window.getByTestId("session-row-s_side_chat").click()

  await window.getByRole("button", { name: "Open side chat" }).click()
  const panel = window.getByTestId("side-chat-panel")
  await expect(panel).toBeVisible()

  const ask = panel.getByLabel("Ask a quick question")
  await ask.fill("[[side-chat]] which branch?")
  await ask.press("Enter")
  await expect(panel.getByText("Side answer #1")).toBeVisible({ timeout: 20_000 })

  await ask.fill("[[side-chat]] and the follow-up?")
  // Send stays disabled until the first answer's terminal event lands.
  await expect(panel.getByRole("button", { name: "Send side question" })).toBeEnabled({ timeout: 20_000 })
  await ask.press("Enter")
  await expect(panel.getByText("Side answer #2")).toBeVisible({ timeout: 20_000 })

  // Nothing from the side thread reaches the main transcript.
  const main = window.locator("main, [data-testid='conversation-view']").first()
  await expect(main.getByText("which branch?")).toHaveCount(0)
  await expect(main.getByText(/Side answer/)).toHaveCount(0)

  await panel.getByRole("button", { name: "Close side chat" }).click()
  await expect(panel).toHaveCount(0)
  await window.getByRole("button", { name: "Open side chat" }).click()
  await expect(window.getByTestId("side-chat-panel").getByText(/Side answer/)).toHaveCount(0)
})
