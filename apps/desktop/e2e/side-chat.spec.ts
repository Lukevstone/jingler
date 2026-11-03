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

  // A real main turn first, so the isolation checks below have a transcript to look at.
  const transcript = window.getByTestId("conversation-scroll")
  const composer = window.getByPlaceholder("Message the agent…")
  await composer.fill("Main thread question")
  await composer.press("Enter")
  await expect(transcript.getByText("Main thread question")).toBeVisible({ timeout: 20_000 })

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

  // The transcript is really there, and nothing from the side thread reached it.
  await expect(transcript).toBeVisible()
  await expect(transcript.getByText("Main thread question")).toBeVisible()
  await expect(transcript.getByText(/which branch\?|follow-up\?/)).toHaveCount(0)
  await expect(transcript.getByText(/Side answer/)).toHaveCount(0)

  await panel.getByRole("button", { name: "Close side chat" }).click()
  await expect(panel).toHaveCount(0)
  await window.getByRole("button", { name: "Open side chat" }).click()
  await expect(window.getByTestId("side-chat-panel").getByText(/Side answer/)).toHaveCount(0)
})

test("/btw in the composer opens the side chat and asks there, not in the main thread", async ({ launchApp }) => {
  const { window } = await launchApp({
    configured: true,
    withRepo: true,
    sessions: (context) => [{ ...session, worktreePath: context.repoPath }]
  })
  await window.setViewportSize({ width: 1600, height: 900 })
  await expect(appShell(window)).toBeVisible()
  await window.getByTestId("session-row-s_side_chat").click()

  const composer = window.getByPlaceholder("Message the agent…")
  await composer.fill("/btw [[side-chat]] quick one")
  await composer.press("Enter")

  const panel = window.getByTestId("side-chat-panel")
  await expect(panel.getByText("[[side-chat]] quick one")).toBeVisible({ timeout: 20_000 })
  await expect(panel.getByText("Side answer #1")).toBeVisible({ timeout: 20_000 })
  await expect(composer).toHaveValue("")
  await expect(window.getByTestId("conversation-scroll").getByText(/quick one|Side answer/)).toHaveCount(0)
})
