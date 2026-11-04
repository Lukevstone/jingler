import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BugReportDialog, type BugReportDialogProps } from "./bug-report-dialog.js"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const png = (name = "a.png") => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" })

/** Parent that owns `open`, like UserMenu does, and keeps the dialog mounted. */
function Harness({ onSubmit }: { onSubmit: BugReportDialogProps["onSubmit"] }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button onClick={() => setOpen(true)}>reopen</button>
      <BugReportDialog open={open} onOpenChange={setOpen} chats={[]} onSubmit={onSubmit} />
    </>
  )
}

const titleInput = () => screen.getByLabelText(/Title/) as HTMLInputElement
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement

describe("BugReportDialog", () => {
  it("Cancel discards the draft: reopening shows an empty form", async () => {
    const user = userEvent.setup()
    render(<Harness onSubmit={async () => ({ url: "u" })} />)
    await user.type(titleInput(), "draft")
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    await user.click(screen.getByText("reopen"))
    expect(titleInput().value).toBe("")
  })

  it("Done after success reopens to a fresh form, not the success screen", async () => {
    const user = userEvent.setup()
    render(<Harness onSubmit={async () => ({ url: "https://github.com/x/y/issues/1" })} />)
    await user.type(titleInput(), "bug")
    await user.click(screen.getByRole("button", { name: "Send report" }))
    await user.click(await screen.findByRole("button", { name: "Done" }))
    await user.click(screen.getByText("reopen"))
    expect(titleInput().value).toBe("")
    expect(screen.queryByText(/your report was filed/)).toBeNull()
  })

  it("cannot be dismissed while sending, so a late result can't hit a new draft", async () => {
    const user = userEvent.setup()
    let finish: (value: { url: string }) => void = () => {}
    const onOpenChange = vi.fn()
    render(
      <BugReportDialog
        open
        onOpenChange={onOpenChange}
        chats={[]}
        onSubmit={() => new Promise((resolve) => (finish = resolve))}
      />
    )
    await user.type(titleInput(), "bug")
    await user.click(screen.getByRole("button", { name: "Send report" }))
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true)
    await user.keyboard("{Escape}")
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    finish({ url: "https://github.com/x/y/issues/2" })
    await screen.findByText(/your report was filed/)
  })

  it("keeps Send disabled while screenshots are still being read", async () => {
    const user = userEvent.setup()
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(() => {})
    render(<Harness onSubmit={async () => ({ url: "u" })} />)
    await user.type(titleInput(), "bug")
    fireEvent.change(fileInput(), { target: { files: [png()] } })
    await waitFor(() => expect((screen.getByRole("button", { name: /Send report/ }) as HTMLButtonElement).disabled).toBe(true))
  })

  it("shows an error instead of throwing when a file can't be read", async () => {
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      queueMicrotask(() => this.onerror?.(new ProgressEvent("error") as ProgressEvent<FileReader>))
    })
    render(<Harness onSubmit={async () => ({ url: "u" })} />)
    fireEvent.change(fileInput(), { target: { files: [png()] } })
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Could not read one of the selected files.")
  })

  it("reads at most five files even if more are selected", async () => {
    const read = vi.spyOn(FileReader.prototype, "readAsDataURL")
    render(<Harness onSubmit={async () => ({ url: "u" })} />)
    fireEvent.change(fileInput(), { target: { files: Array.from({ length: 8 }, (_, i) => png(`${i}.png`)) } })
    await waitFor(() => expect(document.querySelectorAll("li img")).toHaveLength(5))
    expect(read).toHaveBeenCalledTimes(5)
  })

  it("caps the description at the server's 20,000 characters", () => {
    render(<Harness onSubmit={async () => ({ url: "u" })} />)
    expect((screen.getByLabelText("What happened?") as HTMLTextAreaElement).maxLength).toBe(20_000)
  })
})
