import { executionTargetOf, type Chat, type Session } from "./domain.js"
import { piEndpointId } from "./runtime/agent-endpoint.js"

/** The runtime identity a chat runs under, falling back to the session's. */
export const chatRuntimeIdentity = (session: Session, chat: Chat | undefined) => {
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

/**
 * Runtimes whose side-chat path is both forked (never touches the main session)
 * and tool-less. OpenCode resumes its continuation in place and keeps read tools.
 */
const SIDE_CHAT_RUNTIMES: ReadonlySet<string> = new Set(["claude", "pi"])

export type SideChatSupport = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/** One rule for the toggle and the backend: where can a side question run safely? */
export const sideChatSupport = (session: Session, chatId: string): SideChatSupport => {
  const identity = chatRuntimeIdentity(session, session.chats.find((chat) => chat.id === chatId))
  if (executionTargetOf(session).kind !== "local") {
    return { ok: false, reason: "Side chat isn't available on remote sessions yet." }
  }
  if (
    identity.endpointId === undefined ||
    identity.modelId === undefined ||
    (identity.runtimeId === "pi" && identity.connectionId === undefined)
  ) {
    return { ok: false, reason: "The session has no canonical provider connection" }
  }
  return SIDE_CHAT_RUNTIMES.has(identity.runtimeId)
    ? { ok: true }
    : { ok: false, reason: `Side chat isn't available for ${identity.runtimeId} chats yet.` }
}

/** `/btw question` from the composer → "question"; anything else → null. */
export const sideChatQuestion = (text: string): string | null =>
  /^\/btw\s+([\s\S]*\S)/u.exec(text.trim())?.[1] ?? null
