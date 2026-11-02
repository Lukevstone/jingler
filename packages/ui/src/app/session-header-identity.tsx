import type { ReactNode } from "react"
import { HeaderLinkChips, type HeaderLinkChip } from "./header-view-buttons.js"

/**
 * Left of the session header: outlined issue / link chips. The title and branch
 * went — the sidebar row and the chat tab already show both.
 */
export function SessionHeaderIdentity({
  chips,
  children
}: {
  readonly chips: ReadonlyArray<HeaderLinkChip>
  /** Extra chips (e.g. the multi-PR menu) after the link chips. */
  readonly children?: ReactNode
}) {
  return (
    <div data-testid="session-header-identity" className="flex min-w-0 items-center gap-2">
      <HeaderLinkChips chips={chips} />
      {children}
    </div>
  )
}
