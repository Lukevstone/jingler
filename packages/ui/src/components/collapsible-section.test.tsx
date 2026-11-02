import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CollapsibleSection } from "./collapsible-section.js"

afterEach(cleanup)

const Harness = ({ initial }: { initial: boolean }) => {
  const [open, setOpen] = useState(initial)
  return (
    <CollapsibleSection data-testid="section" title="api · feat/x" trailing={<span>3</span>} open={open} onOpenChange={setOpen}>
      <p>body</p>
    </CollapsibleSection>
  )
}

describe("CollapsibleSection", () => {
  it("reflects the controlled open state", () => {
    render(<Harness initial={false} />)
    expect((screen.getByTestId("section") as HTMLDetailsElement).open).toBe(false)
    expect(screen.getByText("3")).toBeTruthy()
  })

  it("reports the toggle to the parent", () => {
    const onOpenChange = vi.fn()
    render(<CollapsibleSection data-testid="section" title="web" open={false} onOpenChange={onOpenChange}><p>body</p></CollapsibleSection>)
    const details = screen.getByTestId("section") as HTMLDetailsElement
    details.open = true
    fireEvent(details, new Event("toggle"))
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })
})
