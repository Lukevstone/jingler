import { createContext, useContext, useState, type ReactNode } from "react"
import { MotionConfig } from "motion/react"
import { WidthTierProvider } from "../hooks/width-tier.js"
import { TitleBar } from "./title-bar.js"

const WindowDockContext = createContext<HTMLElement | null>(null)

/** The window-level right dock (below the title bar, beside everything else); portal panels like the side chat into it. */
export const useWindowDock = () => useContext(WindowDockContext)

/** The window frame: title bar plus routed content. */
export function AppShell({
  actions,
  platform,
  windowControls,
  banner,
  children
}: {
  /** App-level controls pinned to the title bar's right edge. */
  actions?: ReactNode
  platform?: string
  windowControls?: Parameters<typeof TitleBar>[0]["windowControls"]
  /** Full-width notice under the title bar (e.g. offline). */
  banner?: ReactNode
  children: ReactNode
}) {
  const [dock, setDock] = useState<HTMLElement | null>(null)
  return (
    // `reducedMotion="user"` is the ONE place the app honours
    // `prefers-reduced-motion`: it makes every transform and layout animation
    // instant while leaving opacity fades alone, so a split still reads as
    // changing without anything sliding. Doing this per-component would be four
    // places to forget; doing it here means a new animated component is
    // accessible by default.
    <MotionConfig reducedMotion="user">
      <div
        data-testid="app-background"
        className="flex h-full flex-col overflow-hidden bg-panel text-text"
      >
        <TitleBar actions={actions} platform={platform} windowControls={windowControls} />
        {banner}
        <div className="flex min-h-0 min-w-0 flex-1">
          {/*
            The outermost width boundary: this row is the whole content area, so
            `usePaneWidth()` beneath it reports how much room the SHELL has. The
            sidebar reads it to decide rail-vs-docked. Panes install their own,
            narrower providers further down (`session-pane.tsx`), which shadow this
            one for their own subtrees — each thing collapsing against the box that
            actually constrains it.
          */}
          <WindowDockContext.Provider value={dock}>
            <WidthTierProvider>{children}</WidthTierProvider>
          </WindowDockContext.Provider>
          <div ref={setDock} data-testid="window-dock" className="flex min-h-0 flex-none empty:hidden" />
        </div>
      </div>
    </MotionConfig>
  )
}
