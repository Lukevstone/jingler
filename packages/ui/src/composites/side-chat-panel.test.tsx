import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SideChatPanel } from "./side-chat-panel.js"

afterEach(cleanup)

const props = (over: Partial<Parameters<typeof SideChatPanel>[0]> = {}) => ({
  messages: [],
  busy: false,
  onAsk: vi.fn(),
  onClose: vi.fn(),
  ...over
})

describe("SideChatPanel", () => {
  it("sends the trimmed question on Enter and clears the draft", () => {
    const p = props()
    render(<SideChatPanel {...p} />)
    const input = screen.getByLabelText("Ask a quick question")
    fireEvent.change(input, { target: { value: "  which branch?  " } })
    fireEvent.submit(input.closest("form")!)
    expect(p.onAsk).toHaveBeenCalledWith("which branch?")
    expect((input as HTMLInputElement).value).toBe("")
  })

  it("won't send blank text or while an answer is streaming", () => {
    const p = props({ busy: true })
    render(<SideChatPanel {...p} />)
    const input = screen.getByLabelText("Ask a quick question")
    fireEvent.change(input, { target: { value: "follow-up" } })
    fireEvent.submit(input.closest("form")!)
    expect(p.onAsk).not.toHaveBeenCalled()
    expect((screen.getByLabelText("Send side question") as HTMLButtonElement).disabled).toBe(true)
    expect((input as HTMLInputElement).value).toBe("follow-up")
  })

  it("renders the thread and error, and closes", () => {
    const p = props({
      messages: [
        { id: "u1", role: "user", text: "Are we on JWT?" },
        { id: "a1", role: "assistant", text: "Session cookies." }
      ],
      error: "Side chat failed"
    })
    render(<SideChatPanel {...p} />)
    expect(screen.getByText("Are we on JWT?")).toBeTruthy()
    expect(screen.getByText("Session cookies.")).toBeTruthy()
    expect(screen.getByRole("alert").textContent).toContain("Side chat failed")
    fireEvent.click(screen.getByLabelText("Close side chat"))
    expect(p.onClose).toHaveBeenCalledOnce()
  })
})
