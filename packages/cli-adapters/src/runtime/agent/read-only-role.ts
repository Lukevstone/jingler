import type { AgentRole, AgentRunSpec, Message, Session } from "@jingler/core"
import { CURRENT_RUNTIME_CONTRACTS, activeCheckoutOf, piEndpointId } from "@jingler/core"
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

const identityOf = (session: Session, chat: Session["chats"][number] | undefined) => {
  const connectionId = chat?.connectionId ?? session.connectionId
  const targetId = session.environmentId ?? "desktop"
  return {
    connectionId,
    targetId,
    runtimeId: chat?.runtimeId ?? session.runtimeId ?? "pi",
    endpointId: chat?.endpointId ?? session.endpointId ?? (
      connectionId === undefined ? undefined : piEndpointId(targetId, connectionId)
    ),
    modelId: chat?.modelId ?? session.modelId,
    providerId: chat?.providerId ?? session.providerId
  }
}

/** A fresh-or-forked, non-mutating spec through the chat's pinned runtime identity. */
export const readOnlySpec = (
  session: Session,
  chatId: string,
  role: Extract<AgentRole, "title" | "background" | "side-chat">,
  prompt: string,
  thread: ReadonlyArray<Message> = []
): Either.Either<AgentRunSpec, AgentRuntimeError> => {
  const chat = session.chats.find((candidate) => candidate.id === chatId)
  const { connectionId, runtimeId, targetId, endpointId, modelId, providerId } = identityOf(session, chat)
  if (endpointId === undefined || modelId === undefined || (runtimeId === "pi" && connectionId === undefined)) {
    return Either.left(new AgentRuntimeError({
      reason: "authentication",
      message: "The session has no canonical provider connection"
    }))
  }
  const continuation = role === "side-chat" ? chat?.continuation ?? null : null
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
    priorMessages: thread,
    // A continuation from another runtime/endpoint can't be forked; the thread alone seeds it.
    continuation: continuation?.runtimeId === runtimeId && continuation.endpointId === endpointId ? continuation : null,
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

/** Stream one side-chat answer: forks the chat's context, no tools, nothing persisted. */
export const runSideChat = (
  runtime: AgentRuntimeShape,
  session: Session,
  chatId: string,
  thread: ReadonlyArray<Message>,
  prompt: string
) =>
  Stream.unwrap(Effect.map(readOnlySpec(session, chatId, "side-chat", prompt, thread), (spec) =>
    runtime.run(spec, deniedContext).pipe(
      Stream.filter((event) =>
        event._tag === "Assistant" || event._tag === "Thinking" ||
        event._tag === "Done" || event._tag === "Failed")
    )))
