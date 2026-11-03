/** One side-chat actor per session:chat, so the lane header button and the pane dock share it. */
import { createActor, type ActorRefFrom } from "xstate"
import { sideChatMachine } from "./side-chat-machine.js"

type SideChatActor = ActorRefFrom<typeof sideChatMachine>
const actors = new Map<string, SideChatActor>()

export const sideChatActor = (sessionId: string, chatId: string): SideChatActor => {
  const key = `${sessionId}\0${chatId}`
  let actor = actors.get(key)
  if (actor === undefined) {
    actor = createActor(sideChatMachine).start()
    actors.set(key, actor)
  }
  return actor
}
