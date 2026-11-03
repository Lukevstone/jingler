/** Thin React binding for the side chat dock. */
import { useMachine } from "@xstate/react"
import { useCallback } from "react"
import { sideChatMachine } from "./side-chat-machine.js"

export function useSideChat(sessionId: string, chatId: string) {
  const [state, send] = useMachine(sideChatMachine)
  const open = !state.matches("closed")
  return {
    open,
    busy: state.matches({ open: "streaming" }),
    messages: state.context.messages,
    error: state.context.error,
    expanded: state.context.expanded,
    toggle: useCallback(
      () => send(open ? { type: "CLOSE" } : { type: "OPEN", sessionId, chatId }),
      [send, open, sessionId, chatId]
    ),
    ask: useCallback((text: string) => send({ type: "ASK", text }), [send]),
    /** `/btw <question>` from the composer: open the dock (if shut) and ask in one go. */
    askFromComposer: useCallback((text: string) => {
      send({ type: "OPEN", sessionId, chatId })
      send({ type: "ASK", text })
    }, [send, sessionId, chatId]),
    close: useCallback(() => send({ type: "CLOSE" }), [send]),
    toggleExpand: useCallback(() => send({ type: "TOGGLE_EXPAND" }), [send])
  }
}
