/** Puts the side chat toggle next to New chat in every chat lane header. */
import { sideChatSupport, type Session } from "@jingler/core"
import { ChatLaneActionsContext, SideChatToggleButton } from "@jingler/ui"
import { useCallback, type ReactNode } from "react"
import { useSideChat } from "./use-side-chat.js"

function SideChatLaneToggle({ session, chatId }: { readonly session: Session; readonly chatId: string }) {
  const sideChat = useSideChat(session.id, chatId)
  return <SideChatToggleButton active={sideChat.open} onClick={sideChat.toggle} />
}

export function SideChatLaneActionsProvider({ sessions, children }: { readonly sessions: ReadonlyArray<Session>; readonly children: ReactNode }) {
  const render = useCallback((chatId: string): ReactNode => {
    const session = sessions.find((candidate) => candidate.chats.some((chat) => chat.id === chatId))
    if (session === undefined || !sideChatSupport(session, chatId).ok) return null
    return <SideChatLaneToggle key={`${session.id}:${chatId}`} session={session} chatId={chatId} />
  }, [sessions])
  return <ChatLaneActionsContext.Provider value={render}>{children}</ChatLaneActionsContext.Provider>
}
