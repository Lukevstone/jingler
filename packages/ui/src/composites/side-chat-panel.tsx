import type { Message, ProviderId } from "@jingler/core"
import { ArrowUp, Maximize2, MessageCircleQuestion, Minimize2, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "../components/button.js"
import { ThinkingOrb } from "../components/loading.js"
import { Tooltip } from "../components/tooltip.js"
import { cn } from "../lib/cn.js"
import { MessageTurn } from "./message-turn.js"

export interface SideChatEntry {
  readonly id: string
  readonly role: "user" | "assistant"
  readonly text: string
  readonly streaming?: boolean
}

const toMessage = (entry: SideChatEntry): Message => ({
  id: entry.id,
  role: entry.role,
  parts: entry.text === "" ? [] : [{ _tag: "Text", text: entry.text }],
  streaming: entry.streaming ?? false,
  createdAt: new Date(0).toISOString()
})

export interface SideChatPanelProps {
  readonly messages: ReadonlyArray<SideChatEntry>
  /** True while an answer is streaming; the draft stays editable but send is disabled. */
  readonly busy: boolean
  readonly error?: string | null
  readonly expanded?: boolean
  /** The main chat's provider, for the assistant eyebrow (same as the transcript). */
  readonly providerId?: ProviderId | null
  readonly onAsk: (text: string) => void
  readonly onClose: () => void
  readonly onToggleExpand?: () => void
  readonly className?: string
}

/** Right-hand "Side chat" dock: quick questions about the session that never enter it. */
export function SideChatPanel({
  messages,
  busy,
  error,
  expanded = false,
  providerId,
  onAsk,
  onClose,
  onToggleExpand,
  className
}: SideChatPanelProps) {
  const [draft, setDraft] = useState("")
  const end = useRef<HTMLDivElement>(null)
  const turns = useMemo(() => messages.filter((m) => m.role === "user" || m.text !== "").map(toMessage), [messages])
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }) }, [messages, busy])
  const send = () => {
    const text = draft.trim()
    if (text === "" || busy) return
    onAsk(text)
    setDraft("")
  }
  return (
    <aside
      data-testid="side-chat-panel"
      aria-label="Side chat"
      className={cn("flex h-full min-w-0 flex-col border-l border-line bg-editor", className)}
    >
      <header className="flex h-10 flex-none items-center gap-1 border-b border-hairline bg-sunken/70 px-3">
        <span className="flex-1 text-xs font-medium text-text-bright">Side chat</span>
        {onToggleExpand && (
          <Button variant="ghost" size="icon" className="size-7" aria-label={expanded ? "Collapse side chat" : "Expand side chat"} onClick={onToggleExpand}>
            {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>
        )}
        <Button variant="ghost" size="icon" className="size-7" aria-label="Close side chat" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4 [scrollbar-gutter:stable]">
        <p className="rounded-lg bg-sunken px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
          Chat about this session without touching the main thread. The agent sees the full context, and nothing here is added to the session.
        </p>
        {turns.map((message) => (
          <MessageTurn key={message.id} message={message} providerId={providerId} />
        ))}
        {busy && (
          <div data-testid="side-chat-thinking" className="flex justify-start">
            <ThinkingOrb compact />
          </div>
        )}
        {error && <p role="alert" className="text-[12px] text-state-failed">{error}</p>}
        <div ref={end} />
      </div>
      <form className="flex-none px-3 pb-3 pt-2" onSubmit={(event) => { event.preventDefault(); send() }}>
        <div className="flex items-end gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 focus-within:border-line-strong">
          <textarea
            aria-label="Ask a quick question"
            placeholder="Ask a quick question…"
            rows={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
              event.preventDefault()
              send()
            }}
            className="field-sizing-content max-h-40 min-h-[22px] min-w-0 flex-1 resize-none overflow-y-auto bg-transparent text-[13px] leading-[1.5] text-text-body outline-none placeholder:text-dim"
          />
          <Button
            type="submit"
            variant="primary"
            size="icon"
            className="size-7 flex-none rounded-full"
            aria-label="Send side question"
            title="Send (↵)"
            disabled={busy || draft.trim() === ""}
          >
            <ArrowUp size={14} />
          </Button>
        </div>
      </form>
    </aside>
  )
}

/** Opens/closes the side chat dock; lives next to New chat in the chat lane header. */
export function SideChatToggleButton({ active, onClick, className }: { active: boolean; onClick: () => void; className?: string }) {
  return (
    <Tooltip label={active ? "Close side chat" : "Side chat · ask without touching this thread"} side="bottom">
      <Button
        variant="ghost"
        size="sm"
        data-testid="side-chat-toggle"
        aria-label={active ? "Close side chat" : "Open side chat"}
        aria-pressed={active}
        onClick={onClick}
        className={cn("flex-none px-1.5", active && "bg-text-bright/5 text-text-bright", className)}
      >
        <MessageCircleQuestion className="size-3.5" />
      </Button>
    </Tooltip>
  )
}
