import { randomUUID } from "node:crypto"
import type { RelayedToolCall } from "./claude-cli-sampling-relay.js"
import { recordOf } from "./claude-cli-tool-rescue.js"

const OPEN = "<jingler-tool-call "
const CLOSE = "</jingler-tool-call>"
const HEAD = /^<jingler-tool-call id="[^"]*" name="([^"]+)">(?:\s|<br>)*/u
const PARAMETER_OPEN = "<jingler-parameter "
const PARAMETER = /<jingler-parameter name="([^"]+)">([\s\S]*?)<\/jingler-parameter>/gu
const BREAKS = /(?:<br>\s*)*$/u
/** Trailing text that could still grow into a call once the next delta lands. */
const UNFINISHED = /(?:<br>\s*)*(?:<[a-z-]*)?$/u
const FENCE = /^[ \t]*(`{3,}(?=[^`]*$)|~{3,})(.*)$/u
const CODE_SPAN = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/gu

const closesFence = (fence: string, marker: string, rest: string): boolean =>
  marker[0] === fence[0] && marker.length >= fence.length && rest.trim() === ""

/** Over-matches on purpose: a stray backtick only leaves a real call printed as text. */
const isQuoted = (before: string): boolean => {
  let fence = ""
  let paragraph = ""
  const lines = before.split("\n")
  for (const [index, line] of lines.entries()) {
    const [, marker = "", rest = ""] = FENCE.exec(line) ?? []
    if (fence !== "") {
      if (closesFence(fence, marker, rest)) fence = ""
      continue
    }
    fence = marker
    // The last entry is the call's own line, so being empty there isn't a blank line.
    const blank = line.trim() === "" && index < lines.length - 1
    paragraph = marker !== "" || blank ? "" : `${paragraph}${line}\n`
  }
  return fence !== "" || paragraph.replace(CODE_SPAN, "").includes("`")
}

/** A call needs its own unindented line, or to follow a finished sentence. */
const canStartCall = (before: string): boolean =>
  !isQuoted(before) &&
  /(?:(?:^|\n) {0,3}|[.!?][ \t]*)$/u.test(before.slice(0, before.search(BREAKS)))

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

interface BodyScan {
  at: number
  quoted: boolean
  /** Parameter values are raw text, so their quotes mean nothing. */
  plain: boolean
}

/** Stops after the closing quote, or at the end of the text if the string runs on. */
const skipString = (text: string, scan: BodyScan): void => {
  for (; scan.at < text.length; scan.at += 1) {
    const char = text[scan.at]
    if (char === "\\") scan.at += 1
    else if (char === "\"") {
      scan.quoted = false
      scan.at += 1
      return
    }
  }
}

/** Resumes where the last delta stopped, and skips closing tags inside JSON strings. */
const findClose = (text: string, scan: BodyScan): number => {
  while (scan.at < text.length) {
    if (scan.quoted) {
      skipString(text, scan)
      continue
    }
    const char = text[scan.at]
    if (char === "\"" && !scan.plain) scan.quoted = true
    else if (char === "<") {
      if (text.length - scan.at < CLOSE.length) return -1
      if (text.startsWith(CLOSE, scan.at)) return scan.at
      scan.plain ||= text.startsWith(PARAMETER_OPEN, scan.at)
    }
    scan.at += 1
  }
  return -1
}

export interface TextToolCallScan {
  /** Text that is safe to show now. */
  readonly text: string
  /** A call typed into the reply. Everything after it is dropped, which also blocks invented results. */
  readonly call: RelayedToolCall | null
}

/** One pass over the held text. `more` means another tag may follow what it released. */
type GuardPass = TextToolCallScan & { readonly more: boolean }

const stop = (text: string, call: RelayedToolCall | null = null): GuardPass => ({ text, call, more: false })
const more = (text: string): GuardPass => ({ text, call: null, more: true })

/**
 * Catch tool calls the model typed as text. They never reach the relay, so
 * without this they print to chat, never run, and the turn can end on them.
 * Text is held back only while it might be a call; anything that turns out not
 * to be one is released unchanged.
 */
export const makeTextToolCallGuard = (offered: ReadonlySet<string>) => {
  let pending = ""
  let shown = ""
  let body: BodyScan | null = null

  const release = (end: number): string => {
    const chunk = pending.slice(0, end)
    pending = pending.slice(end)
    shown += chunk
    if (body !== null) body.at -= end
    return chunk
  }

  const readBody = (at: number, scan: BodyScan): GuardPass => {
    const safeEnd = pending.slice(0, at).search(BREAKS)
    const close = findClose(pending, scan)
    if (close === -1) return stop(release(safeEnd))
    const call = parseCall(pending.slice(at, close), offered)
    if (call !== null) return stop(release(safeEnd), call)
    body = null
    return more(release(close + CLOSE.length))
  }

  const step = (): GuardPass => {
    const at = pending.indexOf(OPEN)
    if (at === -1) return stop(release(pending.search(UNFINISHED)))
    if (body !== null) return readBody(at, body)
    const before = pending.slice(0, at)
    if (!canStartCall(shown + before)) return more(release(at + OPEN.length))
    const headLength = pending.slice(at).search(/[>\n]/u) + 1
    if (headLength === 0) return stop(release(before.search(BREAKS)))
    const name = HEAD.exec(pending.slice(at, at + headLength))?.[1]
    if (name === undefined || !offered.has(name)) return more(release(at + headLength))
    body = { at: at + headLength, quoted: false, plain: false }
    return readBody(at, body)
  }

  const push = (delta: string): TextToolCallScan => {
    pending += delta
    let text = ""
    for (;;) {
      const result = step()
      text += result.text
      if (!result.more) return { text, call: result.call }
    }
  }

  return { push, flush: () => release(pending.length) }
}
