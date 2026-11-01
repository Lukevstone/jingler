import { execFileSync } from "node:child_process"
import { activeCheckoutOf, type CreateSessionInput, reduceCheckouts, ProviderConnectionId, ProviderId, ProviderModelId } from "@jingler/core"
import { Effect, Layer, Schema } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { adoptScratchRepo } from "./adopt-scratch-repo.js"
import { GitService } from "./git.js"
import { SessionStore } from "./sessions.js"
import { withTempRoot } from "./test-support.js"

const connectionId = Schema.decodeUnknownSync(ProviderConnectionId)("claude-max")
const providerId = Schema.decodeUnknownSync(ProviderId)("anthropic")
const modelId = Schema.decodeUnknownSync(ProviderModelId)("anthropic/claude-sonnet")

describe("adoptScratchRepo", () => {
  let temp: ReturnType<typeof withTempRoot>
  beforeEach(() => { temp = withTempRoot() })
  afterEach(() => temp.cleanup())

  const services = Layer.mergeAll(SessionStore.Default, GitService.Default)
  type Env = SessionStore | GitService | Layer.Layer.Success<ReturnType<typeof withTempRoot>["layer"]>
  const run = <A, E>(effect: Effect.Effect<A, E, Env>) =>
    Effect.runPromise(effect.pipe(Effect.provide(services), Effect.provide(temp.layer)))
  const registered: Array<{ path: string; name: string }> = []
  const register = (path: string, name: string) => Effect.sync(() => { registered.push({ path, name }); return { id: "p_clubsy" } })
  const autoSession = () => run(SessionStore.create({ title: "Auto", connectionId, providerId, modelId } as CreateSessionInput))

  it("leaves a scratch folder without an origin alone", async () => {
    registered.length = 0
    const session = await autoSession()
    expect(await run(adoptScratchRepo(session.id, register))).toBe(false)
    expect(registered).toEqual([])
    expect(activeCheckoutOf(await run(SessionStore.get(session.id))).repo).toBe("")
  })

  it("skips adoption when a checkout was attached while it was registering", async () => {
    registered.length = 0
    const session = await autoSession()
    const dir = activeCheckoutOf(session).worktreePath!
    execFileSync("git", ["-C", dir, "remote", "add", "origin", "https://github.com/acme/Clubsy.git"])
    const attached = { id: "co_web", repo: "web", repoPath: "/r/web", worktreePath: "/w/web", branch: "main", prNumber: null }
    const racing = (path: string, name: string) => SessionStore.get(session.id).pipe(
      Effect.flatMap((current) => SessionStore.setCheckouts(session.id, reduceCheckouts(current, { type: "attach", checkout: attached }))),
      Effect.zipRight(register(path, name))
    )
    expect(await run(adoptScratchRepo(session.id, racing))).toBe(false)
    const stored = await run(SessionStore.get(session.id))
    expect(stored.checkouts?.map((c) => c.id)).toEqual(["co_web"])
    expect(activeCheckoutOf(stored).repo).toBe("web")
  })

  it("fills the placeholder checkout once the agent adds an origin", async () => {
    registered.length = 0
    const session = await autoSession()
    const dir = activeCheckoutOf(session).worktreePath!
    execFileSync("git", ["-C", dir, "remote", "add", "origin", "https://github.com/acme/Clubsy.git"])
    execFileSync("git", ["-C", dir, "checkout", "-q", "-b", "feat/s0-scaffold"])
    expect(await run(adoptScratchRepo(session.id, register))).toBe(true)
    expect(registered).toEqual([{ path: dir, name: "Clubsy" }])
    const stored = await run(SessionStore.get(session.id))
    expect(activeCheckoutOf(stored)).toMatchObject({ repo: "Clubsy", repoPath: dir, worktreePath: dir, branch: "feat/s0-scaffold", projectId: "p_clubsy", githubSlug: "acme/Clubsy" })
    // Already adopted: a later turn is a no-op.
    expect(await run(adoptScratchRepo(session.id, register))).toBe(false)
  })
})
