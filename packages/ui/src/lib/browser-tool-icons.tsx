import type { LucideIcon } from "lucide-react"
import {
  ArrowLeft,
  ArrowUpDown,
  Braces,
  Camera,
  CornerDownLeft,
  FileText,
  Globe,
  Hourglass,
  Keyboard,
  Link,
  ListFilter,
  ListTree,
  MousePointer2,
  MousePointerClick,
  Network,
  Pointer,
  RotateCw,
  SquareTerminal
} from "lucide-react"
import { cn } from "./cn.js"
import { browserToolOf } from "./tool-names.js"

const BROWSER_TOOL_ICONS: Readonly<Record<string, LucideIcon>> = {
  navigate: Globe,
  screenshot: Camera,
  click: MousePointerClick,
  type: Keyboard,
  hover: MousePointer2,
  press_key: CornerDownLeft,
  scroll: ArrowUpDown,
  select_option: ListFilter,
  read_text: FileText,
  snapshot: ListTree,
  get_url: Link,
  back: ArrowLeft,
  reload: RotateCw,
  evaluate: Braces,
  wait_for_selector: Hourglass,
  network_requests: Network,
  network_request_detail: Network,
  console_logs: SquareTerminal
}

/**
 * The glyph for an in-app browser tool row, or undefined for any other tool.
 * Pulses while the agent is acting so the operator sees the browser is busy.
 */
export const browserToolIcon = (name: string, running: boolean) => {
  const tool = browserToolOf(name)
  if (tool === null) return undefined
  const Icon = BROWSER_TOOL_ICONS[tool] ?? Pointer
  return (
    <Icon
      aria-hidden
      data-testid={`browser-tool-icon-${tool}`}
      className={cn("size-3 flex-none text-brand", running && "animate-pulse motion-reduce:animate-none")}
    />
  )
}
