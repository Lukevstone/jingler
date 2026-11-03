/** Thin React binding for one chat's side chat (shared by the lane header and the dock). */
import { useSelector } from "@xstate/react"
import { useCallback } from "react"
import { sideChatActor } from "./side-chat-registry.js"

export function useSideChat(sessionId: string, chatId: string) {
  const actor = sideChatActor(sessionId, chatId)
  const open = useSelector(actor, (state) => !state.matches("closed"))
  const busy = useSelector(actor, (state) => state.matches({ open: "streaming" }))
  const messages = useSelector(actor, (state) => state.context.messages)
  const error = useSelector(actor, (state) => state.context.error)
  const expanded = useSelector(actor, (state) => state.context.expanded)
  return {
    open,
    busy,
    messages,
    error,
    expanded,
    toggle: useCallback(
      () => actor.send(actor.getSnapshot().matches("closed") ? { type: "OPEN", sessionId, chatId } : { type: "CLOSE" }),
      [actor, sessionId, chatId]
    ),
    ask: useCallback((text: string) => actor.send({ type: "ASK", text }), [actor]),
    /** `/btw <question>` from the composer: open the dock (if shut) and ask in one go. */
    askFromComposer: useCallback((text: string) => {
      actor.send({ type: "OPEN", sessionId, chatId })
      actor.send({ type: "ASK", text })
    }, [actor, sessionId, chatId]),
    close: useCallback(() => actor.send({ type: "CLOSE" }), [actor]),
    toggleExpand: useCallback(() => actor.send({ type: "TOGGLE_EXPAND" }), [actor])
  }
}
