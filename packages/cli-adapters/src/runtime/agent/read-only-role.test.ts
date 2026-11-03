import { Session, nativeCliEndpointId, type Message } from "@jingler/core"
import { Either, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { readOnlySpec } from "./read-only-role.js"

const endpointId = nativeCliEndpointId("desktop", "claude")
const continuation = { runtimeId: "claude", endpointId, id: "main-session" }

const session = (chat: Record<string, unknown> = {}) => Schema.decodeUnknownSync(Session)({
  id: "s1",
  repo: "repo",
  branch: "main",
  prNumber: null,
  title: "s1",
  status: "idle",
  runtimeId: "claude",
  endpointId,
  modelId: "anthropic/opus",
  diff: { added: 0, removed: 0 },
  costUsd: 0,
  tokens: 0,
  updatedAt: "2026-11-03T00:00:00.000Z",
  chats: [{
    id: "c1",
    title: null,
    createdAt: "2026-11-03T00:00:00.000Z",
    updatedAt: "2026-11-03T00:00:00.000Z",
    continuation,
    ...chat
  }],
  activeChatId: "c1",
  worktreePath: "/tmp/s1",
  baseBranch: "main",
  mode: "auto"
})

const thread: ReadonlyArray<Message> = [{
  id: "side-1",
  role: "user",
  parts: [{ _tag: "Text", text: "earlier side question" }],
  streaming: false,
  createdAt: "2026-11-03T00:00:00.000Z"
}]

const right = <A, E>(either: Either.Either<A, E>): A => {
  if (Either.isLeft(either)) throw new Error("expected a spec")
  return either.right
}

describe("readOnlySpec", () => {
  it("forks the chat's continuation for side chats and carries the side thread", () => {
    const spec = right(readOnlySpec(session(), "c1", "side-chat", "follow-up", thread))
    expect(spec).toMatchObject({ role: "side-chat", mode: "read-only", prompt: "follow-up", continuation })
    expect(spec.priorMessages).toEqual(thread)
  })

  it("never resumes the chat for title runs", () => {
    const spec = right(readOnlySpec(session(), "c1", "title", "name it"))
    expect(spec.continuation).toBeNull()
    expect(spec.priorMessages).toEqual([])
  })

  it("drops a continuation owned by another endpoint so the thread seeds a fresh run", () => {
    const other = { ...continuation, endpointId: nativeCliEndpointId("desktop", "codex"), runtimeId: "codex" }
    expect(right(readOnlySpec(session({ continuation: other }), "c1", "side-chat", "q")).continuation).toBeNull()
  })
})
