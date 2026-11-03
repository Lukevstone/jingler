import type { StreamEvent } from "@jingler/core"
import { describe, expect, it, vi } from "vitest"
import { createActor, fromCallback } from "xstate"

vi.mock("./rpc-client.js", () => ({ rpc: {} }))
const { sideChatMachine } = await import("./side-chat-machine.js")
type AskInput = import("./side-chat-machine.js").SideChatAskInput
type SideChatEvent = import("./side-chat-machine.js").SideChatEvent

const harness = () => {
  const calls: AskInput[] = []
  const cancels: Array<ReturnType<typeof vi.fn>> = []
  let emit: (event: StreamEvent) => void = () => undefined
  const actor = createActor(sideChatMachine.provide({
    actors: {
      ask: fromCallback<SideChatEvent, AskInput>(({ input, sendBack }) => {
        calls.push(input)
        emit = (event) => sendBack({ type: "STREAM", event })
        const cancel = vi.fn()
        cancels.push(cancel)
        return cancel
      })
    }
  })).start()
  return { actor, calls, cancels, emit: (event: StreamEvent) => emit(event) }
}

const done: StreamEvent = { _tag: "Done", tokens: 1, costUsd: 0 }

describe("sideChatMachine", () => {
  it("streams an answer, then sends the earlier side thread with a follow-up", () => {
    const { actor, calls, emit } = harness()
    actor.send({ type: "OPEN", sessionId: "s1", chatId: "c1" })
    actor.send({ type: "ASK", text: " which branch? " })
    expect(actor.getSnapshot().matches({ open: "streaming" })).toBe(true)
    expect(calls[0]).toMatchObject({ sessionId: "s1", chatId: "c1", prompt: "which branch?", thread: [] })
    emit({ _tag: "Assistant", text: "feat/" })
    emit({ _tag: "Assistant", text: "side-chat" })
    emit(done)
    const answered = actor.getSnapshot()
    expect(answered.matches({ open: "idle" })).toBe(true)
    expect(answered.context.messages.at(-1)).toMatchObject({ role: "assistant", text: "feat/side-chat", streaming: false })

    actor.send({ type: "ASK", text: "and the base?" })
    expect(calls[1]!.prompt).toBe("and the base?")
    expect(calls[1]!.thread.map((message) => message.parts[0])).toEqual([
      { _tag: "Text", text: "which branch?" },
      { _tag: "Text", text: "feat/side-chat" }
    ])
  })

  it("closing mid-stream cancels the run and wipes the thread", () => {
    const { actor, cancels, emit } = harness()
    actor.send({ type: "OPEN", sessionId: "s1", chatId: "c1" })
    actor.send({ type: "ASK", text: "q" })
    emit({ _tag: "Assistant", text: "partial" })
    actor.send({ type: "CLOSE" })
    expect(cancels[0]).toHaveBeenCalledOnce()
    expect(actor.getSnapshot().matches("closed")).toBe(true)
    expect(actor.getSnapshot().context.messages).toEqual([])
  })

  it("switching chats starts a fresh thread; reopening the same chat keeps it", () => {
    const { actor, cancels, emit } = harness()
    actor.send({ type: "OPEN", sessionId: "s1", chatId: "c1" })
    actor.send({ type: "ASK", text: "q" })
    emit(done)
    actor.send({ type: "OPEN", sessionId: "s1", chatId: "c1" })
    expect(actor.getSnapshot().context.messages).toHaveLength(2)
    actor.send({ type: "ASK", text: "again" })
    actor.send({ type: "OPEN", sessionId: "s1", chatId: "c2" })
    expect(cancels[1]).toHaveBeenCalledOnce()
    expect(actor.getSnapshot().context).toMatchObject({ chatId: "c2", messages: [] })
  })

  it("shows a failure and drops the empty answer bubble", () => {
    const { actor, emit } = harness()
    actor.send({ type: "OPEN", sessionId: "s1", chatId: "c1" })
    actor.send({ type: "ASK", text: "q" })
    emit({ _tag: "Failed", message: "Side chat isn't available on remote sessions yet." })
    const snapshot = actor.getSnapshot()
    expect(snapshot.matches({ open: "idle" })).toBe(true)
    expect(snapshot.context.error).toContain("remote sessions")
    expect(snapshot.context.messages.map((entry) => entry.role)).toEqual(["user"])
  })
})
