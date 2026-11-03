import type { AgentRole, AgentRunSpec, Message, Session } from "@jingler/core"
import { CURRENT_RUNTIME_CONTRACTS, activeCheckoutOf, chatRuntimeIdentity, sideChatSupport } from "@jingler/core"
import { randomUUID } from "node:crypto"
import { Duration, Effect, Either, Stream } from "effect"
import {
  AgentRuntimeError,
  inactiveRuntimeActivity,
  type AgentRuntimeContext,
  type AgentRuntimeShape
} from "./agent-runtime.js"

const deniedContext: AgentRuntimeContext = {
  ...inactiveRuntimeActivity,
  canUseTool: () => Effect.succeed("deny"),
  askQuestion: () => Effect.succeed([])
}

/** A fresh-or-forked, non-mutating spec through the chat's pinned runtime identity. */
export const readOnlySpec = (
  session: Session,
  chatId: string,
  role: Extract<AgentRole, "title" | "background" | "side-chat">,
  prompt: string,
  thread: ReadonlyArray<Message> = [],
  mainTranscript: ReadonlyArray<Message> = []
): Either.Either<AgentRunSpec, AgentRuntimeError> => {
  const chat = session.chats.find((candidate) => candidate.id === chatId)
  const { connectionId, runtimeId, targetId, endpointId, modelId, providerId } = chatRuntimeIdentity(session, chat)
  if (endpointId === undefined || modelId === undefined || (runtimeId === "pi" && connectionId === undefined)) {
    return Either.left(new AgentRuntimeError({
      reason: "authentication",
      message: "The session has no canonical provider connection"
    }))
  }
  const candidate = role === "side-chat" ? chat?.continuation ?? null : null
  // A continuation from another runtime/endpoint can't be forked; the main transcript seeds it instead.
  const continuation = candidate?.runtimeId === runtimeId && candidate.endpointId === endpointId ? candidate : null
  return Either.right({
    runId: randomUUID(),
    sessionId: session.id,
    chatId,
    runtimeId,
    endpointId,
    connectionId,
    providerId,
    modelId,
    role,
    mode: "read-only",
    cwd: activeCheckoutOf(session).worktreePath ?? process.cwd(),
    prompt,
    priorMessages: role === "side-chat" && continuation === null ? [...mainTranscript, ...thread] : thread,
    continuation,
    seed: null,
    targetCapabilities: { versions: CURRENT_RUNTIME_CONTRACTS, toolIds: [], resourceIds: [], targetId }
  })
}

/** Run a fresh non-mutating background role and fold its assistant text. */
export const runReadOnlyRoleText = (
  runtime: AgentRuntimeShape,
  session: Session,
  role: Extract<AgentRole, "title" | "background">,
  prompt: string,
  timeout: Duration.DurationInput
) =>
  Effect.flatMap(readOnlySpec(session, session.activeChatId, role, prompt), (spec) =>
    runtime.run(spec, deniedContext).pipe(
      Stream.runFold("", (text, event) => (event._tag === "Assistant" ? text + event.text : text)),
      Effect.timeout(timeout)
    ))

/** Refuses unsupported chats (OpenCode, remote) before any runtime sees them. */
const sideChatSpec = (session: Session, chatId: string, prompt: string, thread: ReadonlyArray<Message>, mainTranscript: ReadonlyArray<Message>) => {
  const support = sideChatSupport(session, chatId)
  return support.ok
    ? readOnlySpec(session, chatId, "side-chat", prompt, thread, mainTranscript)
    : Either.left(new AgentRuntimeError({ reason: "runtime", message: support.reason }))
}

/** Stream one side-chat answer: forks the chat's context, no tools, nothing persisted. */
export const runSideChat = (
  runtime: AgentRuntimeShape,
  session: Session,
  chatId: string,
  thread: ReadonlyArray<Message>,
  prompt: string,
  /** Used only when the chat's continuation can't be forked. */
  mainTranscript: ReadonlyArray<Message> = []
) =>
  Stream.unwrap(Effect.map(sideChatSpec(session, chatId, prompt, thread, mainTranscript), (spec) =>
    runtime.run(spec, deniedContext).pipe(
      Stream.filter((event) =>
        event._tag === "Assistant" || event._tag === "Thinking" ||
        event._tag === "Done" || event._tag === "Failed")
    )))
