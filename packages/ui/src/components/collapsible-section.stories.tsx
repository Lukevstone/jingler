import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { CollapsibleSection } from "./collapsible-section.js"

const meta: Meta<typeof CollapsibleSection> = { title: "Components/CollapsibleSection", component: CollapsibleSection }
export default meta
type Story = StoryObj<typeof CollapsibleSection>

/** Two repo sections: the active one open, the other collapsed to its header. */
export const RepoSections: Story = {
  render: () => {
    const [open, setOpen] = useState<Record<string, boolean>>({ api: true, web: false })
    return (
      <div className="w-72 border border-line">
        {["api", "web"].map((repo) => (
          <CollapsibleSection key={repo} title={`${repo} · feat/x`} trailing={<span>{repo === "api" ? 4 : 2}</span>} open={open[repo] ?? false} onOpenChange={(next) => setOpen((o) => ({ ...o, [repo]: next }))}>
            <p className="px-3 py-2 text-[12px] text-dim">Changed files…</p>
          </CollapsibleSection>
        ))}
      </div>
    )
  }
}
