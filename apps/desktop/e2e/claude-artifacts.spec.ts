import { appShell, expect, test } from "./fixtures.js"
import type { SeedSession } from "./fixtures.js"

/**
 * A claude.ai artifact link in the transcript opens in the chat's preview dock,
 * not the system browser. The native page is out of the DOM and claude.ai needs
 * a login, so we assert on the dock's address bar, never the loaded page.
 */
const ARTIFACT_URL = "https://claude.ai/artifact/N8nThbQe6ZyN8PewWJdfg9"

const sessions = ({ repoPath }: { repoPath: string }): ReadonlyArray<SeedSession> => [{
  id: "s_artifact",
  repo: "widget",
  branch: "feat/artifact",
  title: "Artifact link",
  status: "idle",
  diff: { added: 0, removed: 0 },
  prNumber: null,
  costUsd: 0,
  tokens: 0,
  updatedAt: "2026-11-02T00:00:00.000Z",
  worktreePath: repoPath,
  mode: "accept-edits"
}]

test("an artifact link in the transcript opens in the preview dock", async ({ launchApp }) => {
  const { window } = await launchApp({
    configured: true,
    isolateSystemHome: true,
    withRepo: true,
    sessions,
    transcripts: {
      s_artifact: [{
        id: "a_artifact",
        role: "assistant",
        streaming: false,
        createdAt: "2026-11-02T00:00:00.000Z",
        parts: [{ _tag: "Text", text: `Published artifact: [Release notes](${ARTIFACT_URL})` }]
      }]
    }
  })
  await expect(appShell(window)).toBeVisible()
  await window.setViewportSize({ width: 1500, height: 860 })

  const link = window.locator("[data-claude-artifact]").filter({ hasText: "Release notes" })
  await expect(link).toBeVisible({ timeout: 10_000 })
  await link.click()

  await expect(window.getByTestId("editor-tab-view-browser")).toBeVisible()
  await expect(window.getByLabel("Preview URL").filter({ visible: true }).first()).toHaveValue(ARTIFACT_URL)
})
