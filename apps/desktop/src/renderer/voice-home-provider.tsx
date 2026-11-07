import { useQuery } from "@tanstack/react-query"
import type { HomeVoiceProvider } from "@jingler/ui"
import { rpc } from "./rpc-client.js"
import { useVoiceInput } from "./use-voice-input.js"

/** Dictation for Home's composer; a component so its ticks re-render this subtree, not `App`. */
export const VoiceHomeProvider: HomeVoiceProvider = ({ onText, children }) => {
  const config = useQuery({ queryKey: ["config"], queryFn: () => rpc.configGet() })
  return children(useVoiceInput(onText, rpc, config.data))
}
