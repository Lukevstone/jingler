import { Effect, Layer } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import { GitHubCli, resetGhRateGate } from "./github-cli.js"
import { fakeCommandExecutor, type FakeCommandHandler } from "./test-support.js"

const run = <A>(effect: Effect.Effect<A, unknown, unknown>, handler: FakeCommandHandler): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(Layer.mergeAll(GitHubCli.Default, fakeCommandExecutor(handler))) as never)) as Promise<A>


const handler = (request: FakeCommandHandler, account = { id: 1, login: "octocat" }, orgRepos = 1): FakeCommandHandler => (command, args, stdin, env) => {
  if (command !== "gh") return
  if (args[0] === "auth" && args[1] === "token") {
    expect(args).toEqual(["auth", "token", "--hostname", "github.com"])
    return { stdout: "scripted-private-credential" }
  }
  // Assert only a boolean so failing tests do not print credentials.
  expect(env.get("GH_TOKEN") === "scripted-private-credential").toBe(true)
  expect(env.get("GH_HOST")).toBe("github.com")
  expect(env.get("GH_DEBUG")).toBe("")
  if (args[0] === "api" && args[1] === "user") return { stdout: JSON.stringify(account) }
  if (args[1] === "rate_limit") return { stdout: JSON.stringify({ resources: { search: { remaining: 0, reset: Math.floor(Date.now() / 1000) + 60 } } }) }
  if (args[1]?.endsWith(`/memberships/${account.login}`)) return { stdout: '{"state":"active"}' }
  if (args[1] === "orgs/acme/repos") return { stdout: JSON.stringify([Array.from({ length: orgRepos }, (_, id) => ({ full_name: `acme/repo${id}` }))]) }
  return request(command, args, stdin, env)
}

afterEach(() => { vi.restoreAllMocks(); resetGhRateGate() })

describe("GitHubCli team inbox", () => {
  it("discovers paginated memberships and ignores enterprise-level teams", async () => {
    const result = await run(GitHubCli.teams(), handler((_command, args) => {
      expect(args).toEqual(expect.arrayContaining(["user/teams", "--hostname", "github.com", "--paginate", "--slurp"]))
      return { stdout: JSON.stringify([
        [{ id: 7, organization: { login: "acme" }, slug: "platform", name: "Platform" }],
        [{ id: 8, organization: { login: "other" }, slug: "web", name: "Web" }, { type: "enterprise" }],
      ]) }
    }))
    expect(result).toEqual({ account: { id: "1", login: "octocat" }, teams: [
      { id: "7", organization: "acme", slug: "platform", name: "Platform" },
      { id: "8", organization: "other", slug: "web", name: "Web" },
    ] })
  })

  const filters = { relationship: "all" as const, repository: "", author: "", label: "", draft: "all" as const, text: "" }
  const team = { accountId: "1", organization: "acme", teamSlug: "platform", queue: "reviews" as const }
  const node = (number: number) => ({
    number, title: `Team PR ${number}`, state: "OPEN", isDraft: false, url: `https://github.com/acme/widget/pull/${number}`,
    repository: { nameWithOwner: "acme/widget" }, author: { login: "teammate" }, updatedAt: "2026-01-01T00:00:00Z",
    assignees: { nodes: [] }, labels: { nodes: [] }, comments: { totalCount: 0 }, reviewRequests: { nodes: [] }
  })
  const page = (nodes: unknown[], remaining = 4000, hasNextPage = false) => ({ stdout: JSON.stringify({ data: {
    viewer: { login: "octocat" }, rateLimit: { remaining, resetAt: new Date(Date.now() + 60_000).toISOString() },
    search: { issueCount: nodes.length, nodes, pageInfo: { hasNextPage, endCursor: hasNextPage ? "c2" : null } }
  } }) })
  const members = { stdout: JSON.stringify([[{ login: "octocat" }, { login: "lee" }]]) }

  it("team reviews search the team and each member in one paged GraphQL call", async () => {
    let body: { query: string; variables: { q: string; after: string | null } } | null = null
    const result = await run(GitHubCli.prSearch({ filters: { ...filters, label: "bug" }, team, after: null, refresh: false }), handler((_command, args, stdin) => {
      if (args[1] === "orgs/acme/teams/platform/members") return members
      expect(args).toEqual(expect.arrayContaining(["graphql", "--input", "-"]))
      body = JSON.parse(stdin)
      return page([node(1)], 4000, true)
    }))
    expect(body!.query).toContain("type:ISSUE_ADVANCED,first:25")
    expect(body!.variables.q).toBe('is:pr is:open org:acme (team-review-requested:acme/platform OR review-requested:octocat OR review-requested:lee) label:"bug" sort:updated-desc')
    expect(result).toMatchObject({ endCursor: "c2", hasNextPage: true, prs: [{ number: 1, repository: "acme/widget" }] })
  })

  it("a later page skips the membership check and passes the cursor", async () => {
    const calls: string[] = []
    let after: unknown
    await run(GitHubCli.prSearch({ filters, team, after: "c2", refresh: false }), handler((_command, args, stdin) => {
      calls.push(args[1]!)
      if (args[1] === "orgs/acme/teams/platform/members") return members
      after = JSON.parse(stdin).variables.after
      return page([])
    }))
    expect(after).toBe("c2")
    expect(calls.some((call) => call.includes("/memberships/"))).toBe(false)
  })

  it("a team with no repositories returns an empty page with a reason, without searching", async () => {
    let searched = false
    const result = await run(GitHubCli.prSearch({ filters, team: { ...team, queue: "repositories" }, after: null, refresh: false }), handler((_command, args) => {
      if (args[1] === "orgs/acme/teams/platform/repos") return { stdout: "[[]]" }
      searched = true
      return page([])
    }))
    expect(searched).toBe(false)
    expect(result.warnings).toEqual(["This team has no repositories of its own."])
  })

  it("low GraphQL quota stops the next page until GitHub's reset", async () => {
    let searches = 0
    const respond = handler((_command, args) => {
      if (args[1] === "orgs/acme/teams/platform/members") return members
      searches++
      return page([node(1)], 50, true)
    })
    await run(GitHubCli.prSearch({ filters, team, after: null, refresh: false }), respond)
    await expect(run(GitHubCli.prSearch({ filters, team, after: "c2", refresh: false }), respond)).rejects.toThrow("rate limit")
    expect(searches).toBe(1)
  })

  it("rejects an account switch before detail, mutation or pickup and never executes the PR command", async () => {
    const actions = [
      GitHubCli.teamPr({ accountId: "2", repository: "acme/widget", number: 42 }),
      GitHubCli.teamComment({ accountId: "2", repository: "acme/widget", number: 42, body: "hi" }),
      GitHubCli.teamClose({ accountId: "2", repository: "acme/widget", number: 42 }),
      GitHubCli.teamMerge({ accountId: "2", repository: "acme/widget", number: 42, method: "merge" }),
      GitHubCli.teamCheckout({ accountId: "2", repository: "acme/widget", number: 42 }),
    ]
    for (const action of actions) {
      let prCalls = 0
      await expect(run(action, handler(() => { prCalls++; return {} }))).rejects.toThrow("account changed")
      expect(prCalls).toBe(0)
    }
  })

  it("keeps mutations pinned to github.com and does not put credentials in argv/stdin", async () => {
    const actions = [
      GitHubCli.teamComment({ accountId: "1", repository: "acme/widget", number: 42, body: "Ship it" }),
      GitHubCli.teamClose({ accountId: "1", repository: "acme/widget", number: 42 }),
      GitHubCli.teamMerge({ accountId: "1", repository: "acme/widget", number: 42, method: "squash" }),
    ]
    const seen: string[] = []
    for (const action of actions) await run(action, handler((_command, args, stdin) => {
      expect(args).toContain("github.com/acme/widget")
      expect(args.join(" ").includes("scripted-private-credential")).toBe(false)
      expect(stdin.includes("scripted-private-credential")).toBe(false)
      seen.push(args[1]!)
      return {}
    }))
    expect(seen).toEqual(["comment", "close", "merge"])
  })

  it("pins successful detail and fork pickup to github.com and disables ambient fetch credentials", async () => {
    const commands: string[][] = []
    const cliHandler = handler((_command, args) => {
      commands.push([...args])
      if (args[0] === "pr") return { stdout: JSON.stringify({
        state: "OPEN", number: 42, title: "Fork", headRefName: "feature", headRefOid: "abc",
        headRepository: { nameWithOwner: "contributor_octo/widget" }, commits: [],
      }) }
      if (args[1]?.startsWith("repos/") && !args[1]?.endsWith("/files")) return { stdout: JSON.stringify({ id: 7, node_id: "R_7", clone_url: "https://github.com/contributor_octo/widget.git" }) }
      if (args[1]?.endsWith("/files")) return { stdout: "[[]]" }
      const field = args.join(" ").includes("commits(first:100") ? "commits" : "reviewThreads"
      return { stdout: JSON.stringify([{ data: { repository: { pullRequest: { [field]: { nodes: [], pageInfo: { hasNextPage: false } } } } } }]) }
    })
    const gitHandler: FakeCommandHandler = (command, args, stdin, env) => {
      if (command !== "git") return cliHandler(command, args, stdin, env)
      if (args.includes("ls-remote")) return { stdout: args[args.length - 1] }
      if (args.includes("config")) return { stdout: "http.https://github.com/.extraheader\ncredential.https://github.com.helper\nhttp.https://github.com/.followredirects" }
      expect(args).toContain("credential.https://github.com.helper=")
      expect(args).toContain("http.https://github.com/.extraheader=")
      expect(args).toContain("http.followRedirects=false")
      expect(args).toContain("http.https://github.com/.followredirects=false")
      expect(env.get("GIT_ALLOW_PROTOCOL")).toBe("https")
      expect(env.get("JINGLER_GIT_ASKPASS_GITHUB_ONLY")).toBe("1")
      expect(env.get("GH_TOKEN")).toBe("")
      expect(args.join(" ").includes("scripted-private-credential")).toBe(false)
      commands.push([...args])
      return {}
    }
    await run(Effect.gen(function* () {
      yield* GitHubCli.teamPr({ accountId: "1", repository: "acme/widget", number: 42 })
      const checkout = yield* GitHubCli.teamCheckout({ accountId: "1", repository: "acme/widget", number: 42 })
      yield* checkout.fetchBase("/repo", "main")
      yield* checkout.fetchHead("/worktree", "refs/remotes/jingler-pr-7/feature")
    }), gitHandler)
    expect(commands.filter((args) => args.includes("fetch")).map((args) => args[args.length - 2])).toEqual([
      "https://github.com/acme/widget.git", "https://github.com/contributor_octo/widget.git",
    ])
    expect(commands.filter((args) => args[0] === "pr").every((args) => args.includes("github.com/acme/widget"))).toBe(true)
  })

  it("rejects invalid discovery/input rather than silently returning empty teams", async () => {
    await expect(run(GitHubCli.teams(), handler(() => ({ stdout: '[{"not":"pages"}]' })))).rejects.toThrow("pagination")
    await expect(run(GitHubCli.prSearch({ filters, team: { ...team, teamSlug: "../secret" }, after: null, refresh: false }), handler(() => ({})))).rejects.toThrow("valid GitHub organization team")
    await expect(run(GitHubCli.teamPr({ accountId: "1", repository: "acme/widget?token=bad", number: 42 }), handler(() => ({})))).rejects.toThrow("valid GitHub pull request")
  })
})
