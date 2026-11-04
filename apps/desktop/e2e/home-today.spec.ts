/** Home › To do (frozen daily review pick, done via node read) and My PRs, through a fake gh CLI. */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { appShell, expect, test } from "./fixtures.js"

const node = (id: string, number: number, title: string, over: Record<string, unknown> = {}) => ({
  id, number, title, url: `https://github.com/acme/widget/pull/${number}`, isDraft: false, state: "OPEN",
  createdAt: `2026-10-0${number % 9 + 1}T00:00:00Z`, updatedAt: `2026-11-0${number % 3 + 1}T00:00:00Z`,
  repository: { nameWithOwner: "acme/widget" }, author: { login: "jo" }, reviewDecision: null,
  viewerLatestReview: null, commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
  ...over
})

const mine = [1, 2, 3, 4, 5].map((n) =>
  node(`PR_mine${n}`, 10 + n, `My change ${n}`, { author: { login: "octocat" }, updatedAt: `2026-11-0${6 - n}T00:00:00Z` }))
const pool = [node("PR_reviewA", 21, "Review alpha"), node("PR_reviewB", 22, "Review beta")]
// Once picked, alpha merges and drops out of the search; only the node read can see it.
const picked = { PR_reviewA: { ...pool[0], state: "MERGED" }, PR_reviewB: pool[1] }

test("Home shows My PRs and a frozen daily review pick that ticks off a merged PR", async ({ launchApp }) => {
  const root = mkdtempSync(join(tmpdir(), "jingler-e2e-home-gh-"))
  const bin = join(root, "bin")
  try {
    mkdirSync(bin)
    writeFileSync(join(bin, "gh"), [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2)",
      "if (args[0] === 'auth' && args[1] === 'status') process.exit(0)",
      "if (args[0] === 'api' && args[1] === 'graphql' && args.includes('--input')) {",
      "  let body = ''",
      "  process.stdin.on('data', (d) => body += d).on('end', () => {",
      "    const { variables } = JSON.parse(body)",
      `    const mine = ${JSON.stringify(mine)}, pool = ${JSON.stringify(pool)}, picked = ${JSON.stringify(picked)}`,
      "    const remaining = pool.filter((pr) => picked[pr.id].state === 'OPEN' || variables.ids.length === 0)",
      "    console.log(JSON.stringify({ data: {",
      "      viewer: { login: 'octocat' },",
      "      open: { issueCount: mine.length, nodes: mine }, closed: { issueCount: 0, nodes: [] },",
      "      pool: { nodes: remaining }, direct: { nodes: [] },",
      "      picked: variables.ids.map((id) => picked[id] ?? null)",
      "    } }))",
      "  })",
      "  return",
      "}",
      "console.error('unsupported gh command: ' + args.join(' '))",
      "process.exit(1)"
    ].join("\n"))
    chmodSync(join(bin, "gh"), 0o755)

    const { window } = await launchApp({
      configured: true,
      isolateSystemHome: true,
      e2eEnv: { PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` }
    })
    await expect(appShell(window)).toBeVisible()

    const myPrs = window.getByTestId("home-my-prs")
    await expect(myPrs.getByText("My change 1")).toBeVisible({ timeout: 20_000 })
    await expect(myPrs.getByText("My change 4")).toHaveCount(0)
    await expect(myPrs.getByRole("button", { name: "+2 more" })).toBeVisible()

    const todo = window.getByTestId("home-todo")
    await expect(todo.getByText("Review beta")).toBeVisible()
    await expect(todo.getByText("Review alpha")).toBeVisible()
    // The node read resolves the merged pick as done, even though the search no longer returns it.
    await expect(todo.getByText("1 of 2 done today")).toBeVisible({ timeout: 20_000 })
    await expect(todo.getByRole("button", { name: /Review alpha/ }).getByText("Merged")).toBeVisible()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
