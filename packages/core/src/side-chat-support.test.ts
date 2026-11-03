import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { Session } from "./domain.js"
import { nativeCliEndpointId } from "./runtime/agent-endpoint.js"
import { sideChatQuestion, sideChatSupport } from "./side-chat-support.js"

const session = (over: Record<string, unknown> = {}) => Schema.decodeUnknownSync(Session)({
  id: "s1", repo: "repo", branch: "main", prNumber: null, title: "s1", status: "idle",
  runtimeId: "claude", endpointId: nativeCliEndpointId("desktop", "claude"), modelId: "anthropic/opus",
  diff: { added: 0, removed: 0 }, costUsd: 0, tokens: 0, updatedAt: "2026-11-03T00:00:00.000Z",
  chats: [{ id: "c1", title: null, createdAt: "2026-11-03T00:00:00.000Z", updatedAt: "2026-11-03T00:00:00.000Z" }],
  activeChatId: "c1", worktreePath: "/tmp/s1", baseBranch: "main", mode: "auto",
  ...over
})

describe("sideChatSupport", () => {
  it("supports local Claude chats", () => {
    expect(sideChatSupport(session(), "c1")).toEqual({ ok: true })
  })

  it("rejects opencode, codex, remote and identity-less chats", () => {
    const opencode = session({ runtimeId: "opencode", endpointId: nativeCliEndpointId("desktop", "opencode") })
    expect(sideChatSupport(opencode, "c1")).toMatchObject({ ok: false, reason: expect.stringContaining("opencode") })
    // Codex 0.160 can't disable its native shell/agent tools (verified with `codex debug prompt-input`).
    const codex = session({ runtimeId: "codex", endpointId: nativeCliEndpointId("desktop", "codex") })
    expect(sideChatSupport(codex, "c1")).toMatchObject({ ok: false, reason: expect.stringContaining("codex") })
    expect(sideChatSupport(session({ environmentId: "mini" }), "c1")).toMatchObject({ ok: false, reason: expect.stringContaining("remote") })
    expect(sideChatSupport(session({ endpointId: undefined, modelId: undefined }), "c1").ok).toBe(false)
  })
})

describe("sideChatQuestion", () => {
  it("extracts the question after /btw and ignores everything else", () => {
    expect(sideChatQuestion("/btw  which branch?\nand base ")).toBe("which branch?\nand base")
    expect(sideChatQuestion("/btw")).toBeNull()
    expect(sideChatQuestion("/btwx hi")).toBeNull()
    expect(sideChatQuestion("hi /btw there")).toBeNull()
  })
})
