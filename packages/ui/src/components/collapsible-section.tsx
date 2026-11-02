import type { ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "../lib/cn.js"

/**
 * A titled section that collapses to its header row. Native `<details>`, so
 * keyboard and screen-reader behaviour come with the element; `open` is
 * controlled so the parent decides which sections start (or become) open.
 */
export function CollapsibleSection({
  title,
  trailing,
  open,
  onOpenChange,
  children,
  className,
  "data-testid": testId
}: {
  readonly title: ReactNode
  /** Right-aligned header content, e.g. a count. */
  readonly trailing?: ReactNode
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly children: ReactNode
  readonly className?: string
  readonly "data-testid"?: string
}) {
  return (
    <details
      data-testid={testId}
      open={open}
      onToggle={(event) => {
        if (event.currentTarget.open !== open) onOpenChange(event.currentTarget.open)
      }}
      className={cn("group flex flex-col", className)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-wide text-dim outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight size={12} aria-hidden className="flex-none transition-transform group-open:rotate-90" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {trailing}
      </summary>
      {children}
    </details>
  )
}
