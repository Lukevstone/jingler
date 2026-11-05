import { randomUUID } from "node:crypto"
import type { RelayedToolCall } from "./claude-cli-sampling-relay.js"
import { recordOf } from "./claude-cli-tool-rescue.js"

const OPEN = "<jingler-tool-call "
const CLOSE = "</jingler-tool-call>"
const HEAD = /^<jingler-tool-call id="[^"]*" name="([^"]+)">(?:\s|<br>)*/u
const PARAMETER = /<jingler-parameter name="([^"]+)">([\s\S]*?)<\/jingler-parameter>/gu
const BREAKS = /(?:<br>\s*)*$/u
/** Trailing text that could still grow into a call once the next delta lands. */
const UNFINISHED = /(?:<br>\s*)*(?:<[a-z-]*)?$/u

/** Quoted markup stays inert: a call needs its own line, or to follow a finished sentence. */
const canStartCall = (before: string): boolean => {
  if ((before.match(/^```/gmu)?.length ?? 0) % 2 === 1) return false
  const line = before.slice(before.lastIndexOf("\n") + 1)
  if ((line.match(/`/gu)?.length ?? 0) % 2 === 1) return false
  return /(?:^|\n|[.!?])[ \t]*$/u.test(before.slice(0, before.search(BREAKS)))
}

const parseArguments = (body: string): Record<string, unknown> | null => {
  try {
    return recordOf(JSON.parse(body))
  } catch {
    const parameters = [...body.matchAll(PARAMETER)]
    return parameters.length === 0
      ? null
      : Object.fromEntries(parameters.map(([, name, value]) => [name, value]))
  }
}

const parseCall = (markup: string, offered: ReadonlySet<string>): RelayedToolCall | null => {
  const head = HEAD.exec(markup)
  const name = head?.[1]
  if (head === null || name === undefined || !offered.has(name)) return null
  const args = parseArguments(markup.slice(head[0].length))
  return args === null ? null : { id: randomUUID(), name, arguments: args }
}

export interface TextToolCallScan {
  /** Text that is safe to show now. */
  readonly text: string
  /** A call typed into the reply. Everything after it is dropped, which also blocks invented results. */
  readonly call: RelayedToolCall | null
}

/**
 * Catch tool calls the model typed as text. They never reach the relay, so
 * without this they print to chat, never run, and the turn can end on them.
 * Text is held back only while it might be a call; anything that turns out not
 * to be one is released unchanged.
 */
export const makeTextToolCallGuard = (offered: ReadonlySet<string>) => {
  let pending = ""
  let shown = ""

  const release = (end: number): string => {
    const chunk = pending.slice(0, end)
    pending = pending.slice(end)
    shown += chunk
    return chunk
  }

  const push = (delta: string): TextToolCallScan => {
    pending += delta
    let text = ""
    for (;;) {
      const at = pending.indexOf(OPEN)
      if (at === -1) return { text: text + release(pending.search(UNFINISHED)), call: null }
      const before = pending.slice(0, at)
      if (!canStartCall(shown + before)) {
        text += release(at + OPEN.length)
        continue
      }
      const close = pending.indexOf(CLOSE, at)
      if (close === -1) return { text: text + release(before.search(BREAKS)), call: null }
      const call = parseCall(pending.slice(at, close), offered)
      if (call !== null) return { text: text + release(before.search(BREAKS)), call }
      text += release(close + CLOSE.length)
    }
  }

  return { push, flush: () => release(pending.length) }
}
