import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { appShell, expect, test } from "./fixtures.js"

test("QA Q1: Changes lists only uncommitted work, not what the agent already committed", async ({ launchApp }) => {
  const { window } = await launchApp({
    configured: true,
    withRepo: true,
    sessions: ({ repoPath }) => [{
      id: "s_committed",
      repo: "widget",
      branch: "feat/committed",
      baseBranch: "main",
      title: "Committed work",
      status: "idle",
      diff: { added: 0, removed: 0 },
      prNumber: null,
      costUsd: 0,
      tokens: 0,
      updatedAt: "2026-07-26T10:00:00.000Z",
      worktreePath: repoPath,
      mode: "accept-edits"
    }],
    seed: ({ repoPath }) => {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: repoPath })
      git("checkout", "-b", "feat/committed")
      writeFileSync(join(repoPath, "committed.txt"), "already committed\n")
      git("add", "-A")
      git("-c", "user.email=e2e@jingler.dev", "-c", "user.name=e2e", "commit", "-m", "agent work", "--no-gpg-sign")
      writeFileSync(join(repoPath, "pending.txt"), "not yet committed\n")
    }
  })
  await expect(appShell(window)).toBeVisible()
  await window.getByRole("button", { name: "Changes" }).first().click()
  // Changes mirrors other IDEs: uncommitted work only; committed branch work belongs to the PR view.
  const explorer = window.getByTestId("changed-files-explorer")
  await expect(explorer).toBeVisible({ timeout: 20_000 })
  await expect(explorer.locator('[data-item-path="pending.txt"]')).toBeVisible({ timeout: 30_000 })
  await expect(explorer.locator('[data-item-path="committed.txt"]')).toHaveCount(0)
})
