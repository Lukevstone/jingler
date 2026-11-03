/** Side chat dock (Claude Code's /btw): in-memory only, wiped on close or chat switch. */
import type { Message, StreamEvent } from "@jingler/core"
import type { SideChatEntry } from "@jingler/ui"
import { assign, fromCallback, setup } from "xstate"
import { rpc } from "./rpc-client.js"

export interface SideChatAskInput {
  readonly sessionId: string
  readonly chatId: string
  readonly thread: ReadonlyArray<Message>
  readonly prompt: string
}

export interface SideChatContext {
  readonly sessionId: string | null
  readonly chatId: string | null
  readonly messages: ReadonlyArray<SideChatEntry>
  readonly error: string | null
  readonly expanded: boolean
}

export type SideChatEvent =
  | { readonly type: "OPEN"; readonly sessionId: string; readonly chatId: string }
  | { readonly type: "CLOSE" }
  | { readonly type: "TOGGLE_EXPAND" }
  | { readonly type: "ASK"; readonly text: string }
  | { readonly type: "STREAM"; readonly event: StreamEvent }

const EMPTY: SideChatContext = { sessionId: null, chatId: null, messages: [], error: null, expanded: false }

const toMessage = (entry: SideChatEntry): Message => ({
  id: entry.id,
  role: entry.role,
  parts: [{ _tag: "Text", text: entry.text }],
  streaming: false,
  createdAt: new Date(0).toISOString()
})

const updateLast = (messages: ReadonlyArray<SideChatEntry>, change: (entry: SideChatEntry) => SideChatEntry) =>
  messages.map((entry, index) => (index === messages.length - 1 ? change(entry) : entry))

export const sideChatMachine = setup({
  types: { context: {} as SideChatContext, events: {} as SideChatEvent },
  actors: {
    ask: fromCallback<SideChatEvent, SideChatAskInput>(({ input, sendBack }) =>
      rpc.sideChatAsk(input.sessionId, input.chatId, input.thread, input.prompt, (event) =>
        sendBack({ type: "STREAM", event })
      )
    )
  }
}).createMachine({
  id: "sideChat",
  context: EMPTY,
  initial: "closed",
  on: {
    CLOSE: { target: ".closed", actions: assign(() => EMPTY) },
    // Opening on another chat starts a fresh thread; reopening the same chat is a no-op.
    OPEN: {
      guard: ({ context, event }) => context.sessionId !== event.sessionId || context.chatId !== event.chatId,
      target: ".open",
      actions: assign(({ event }) => ({ ...EMPTY, sessionId: event.sessionId, chatId: event.chatId }))
    }
  },
  states: {
    closed: {},
    open: {
      initial: "idle",
      on: { TOGGLE_EXPAND: { actions: assign({ expanded: ({ context }) => !context.expanded }) } },
      states: {
        idle: {
          on: {
            ASK: {
              guard: ({ event }) => event.text.trim() !== "",
              target: "streaming",
              actions: assign(({ context, event }) => ({
                error: null,
                messages: [
                  ...context.messages,
                  { id: crypto.randomUUID(), role: "user" as const, text: event.text.trim() },
                  { id: crypto.randomUUID(), role: "assistant" as const, text: "", streaming: true }
                ]
              }))
            }
          }
        },
        streaming: {
          // Leaving this state (done, close, chat switch) runs the actor's cleanup, which cancels the run.
          invoke: {
            src: "ask",
            input: ({ context }) => {
              const prior = context.messages.slice(0, -2).filter((entry) => entry.text !== "")
              return {
                sessionId: context.sessionId!,
                chatId: context.chatId!,
                thread: prior.map(toMessage),
                prompt: context.messages.at(-2)!.text
              }
            }
          },
          on: {
            STREAM: [
              {
                guard: ({ event }) => event.event._tag === "Assistant",
                actions: assign({
                  messages: ({ context, event }) => updateLast(context.messages, (entry) => ({
                    ...entry,
                    text: entry.text + (event.event._tag === "Assistant" ? event.event.text : "")
                  }))
                })
              },
              {
                guard: ({ event }) => event.event._tag === "Done",
                target: "idle",
                actions: assign({
                  messages: ({ context }) => updateLast(context.messages, (entry) => ({ ...entry, streaming: false }))
                })
              },
              {
                guard: ({ event }) => event.event._tag === "Failed",
                target: "idle",
                actions: assign(({ context, event }) => ({
                  error: event.event._tag === "Failed" ? event.event.message : "Side chat failed",
                  // Drop an empty answer bubble; keep any partial text.
                  messages: context.messages.at(-1)?.text === ""
                    ? context.messages.slice(0, -1)
                    : updateLast(context.messages, (entry) => ({ ...entry, streaming: false }))
                }))
              }
            ]
          }
        }
      }
    }
  }
})
