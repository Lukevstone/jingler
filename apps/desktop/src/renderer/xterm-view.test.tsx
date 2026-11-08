// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The WebGL addon is the one per-tab GPU allocation, and browsers cap live
 * contexts — so `active` must gate it: hidden cells keep their Terminal (and
 * scrollback) but hold no addon. Everything xterm/rpc is mocked; the assertion
 * is purely about when the addon is constructed and disposed.
 */

const h = vi.hoisted(() => ({
  webglInstances: [] as Array<{ disposed: boolean }>,
  loadedAddons: [] as Array<unknown>,
  terminals: [] as Array<{ focus: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>,
  searches: [] as Array<{ findNext: ReturnType<typeof vi.fn>; findPrevious: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>,
  selection: "",
  palette: { background: "#18181b", yellow: "#e5c07b" }
}))

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options = {}
    constructor() { h.terminals.push(this) }
    loadAddon(addon: unknown) {
      h.loadedAddons.push(addon)
    }
    open() {}
    write() {}
    focus = vi.fn()
    dispose = vi.fn()
    getSelection() { return h.selection }
    onData() {
      return { dispose: () => {} }
    }
  }
}))
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  }
}))
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }))
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {
  listener?: (results: { resultIndex: number; resultCount: number }) => void
  constructor() { h.searches.push(this) }
  findNext = vi.fn((query: string) => { this.listener?.({ resultIndex: query === "missing" ? -1 : 0, resultCount: query === "missing" ? 0 : 3 }); return true })
  findPrevious = vi.fn(() => true)
  clearDecorations() {}
  onDidChangeResults(listener: typeof this.listener) { this.listener = listener; return { dispose: () => { this.listener = undefined } } }
  dispose = vi.fn()
} }))
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    disposed = false
    constructor() {
      h.webglInstances.push(this)
    }
    onContextLoss() {}
    dispose() {
      this.disposed = true
    }
  }
}))
vi.mock("@xterm/xterm/css/xterm.css", () => ({}))
vi.mock("@jingler/ui", async (importOriginal) => ({
  ...await importOriginal<typeof import("@jingler/ui")>(),
  useThemeTokens: () => ({ terminal: h.palette })
}))
vi.mock("./rpc-client.js", () => ({
  rpc: {
    terminalWrite: async () => {},
    terminalResize: async () => {},
    terminalAttach: () => () => {}
  }
}))

import { XtermView } from "./xterm-view.js"

beforeEach(() => {
  h.webglInstances.length = 0
  h.loadedAddons.length = 0
  h.terminals.length = 0
  h.searches.length = 0
  h.selection = ""
  h.palette = { background: "#18181b", yellow: "#e5c07b" }
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("XtermView WebGL gating", () => {
  it("creates no WebGL context for a hidden cell", () => {
    render(<XtermView terminalId="t1" active={false} />)
    expect(h.webglInstances).toHaveLength(0)
  })

  it("creates the context when active, and releases it when hidden again", () => {
    const view = render(<XtermView terminalId="t1" active={true} />)
    expect(h.webglInstances).toHaveLength(1)
    expect(h.webglInstances[0]!.disposed).toBe(false)

    view.rerender(<XtermView terminalId="t1" active={false} />)
    expect(h.webglInstances[0]!.disposed).toBe(true)

    // Reactivating attaches a FRESH addon to the same live terminal.
    view.rerender(<XtermView terminalId="t1" active={true} />)
    expect(h.webglInstances).toHaveLength(2)
    expect(h.webglInstances[1]!.disposed).toBe(false)
  })

  it("defaults to active for callers without a tab strip", () => {
    render(<XtermView terminalId="t1" />)
    expect(h.webglInstances).toHaveLength(1)
  })
})

describe("XtermView Find", () => {
  it("captures the terminal shortcut, searches literally, navigates, and returns focus on Escape", () => {
    const globalKey = vi.fn()
    window.addEventListener("keydown", globalKey)
    const view = render(<XtermView terminalId="t1" />)
    const root = view.container.firstElementChild!
    fireEvent.keyDown(root, { key: "f", metaKey: true })
    const input = screen.getByPlaceholderText("Find in terminal…") as HTMLInputElement
    expect(document.activeElement).toBe(input)
    expect(globalKey).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: "error+[socket]" } })
    expect(h.searches[0]?.findNext).toHaveBeenLastCalledWith("error+[socket]", expect.objectContaining({ regex: false, incremental: true }))
    expect(screen.getByRole("status").textContent).toBe("1 of 3")
    // The native clear button must keep Enter activation instead of navigating.
    expect(fireEvent.keyDown(screen.getByRole("button", { name: "Clear" }), { key: "Enter" })).toBe(true)
    fireEvent.keyDown(input, { key: "Enter" })
    expect(h.searches[0]?.findNext).toHaveBeenLastCalledWith("error+[socket]", expect.objectContaining({ incremental: false }))
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true })
    expect(h.searches[0]?.findPrevious).toHaveBeenCalledWith("error+[socket]", expect.anything())
    const focusBefore = h.terminals[0]!.focus.mock.calls.length
    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.queryByPlaceholderText("Find in terminal…")).toBeNull()
    expect(h.terminals[0]?.focus).toHaveBeenCalledTimes(focusBefore + 1)
    fireEvent.keyDown(root, { key: "f", ctrlKey: true })
    const reopened = screen.getByPlaceholderText("Find in terminal…") as HTMLInputElement
    expect(reopened.value).toBe("error+[socket]")
    expect(reopened.selectionStart).toBe(0)
    expect(reopened.selectionEnd).toBe(reopened.value.length)
    expect(h.terminals).toHaveLength(1)
    window.removeEventListener("keydown", globalKey)
  })

  it("leaves shell Enter and Escape alone while the search overlay is open", () => {
    const globalKey = vi.fn()
    window.addEventListener("keydown", globalKey)
    const view = render(<XtermView terminalId="t1" />)
    const root = view.container.firstElementChild!
    fireEvent.keyDown(root, { key: "f", metaKey: true })
    fireEvent.keyDown(root, { key: "Enter" })
    fireEvent.keyDown(root, { key: "Escape" })
    expect(globalKey).toHaveBeenCalledTimes(2)
    expect(screen.getByPlaceholderText("Find in terminal…")).toBeTruthy()
    window.removeEventListener("keydown", globalKey)
  })

  it("seeds a single-line selection, reports no matches, and closes when the terminal becomes hidden", () => {
    h.selection = "selected phrase"
    const view = render(<XtermView terminalId="t1" />)
    fireEvent.keyDown(view.container.firstElementChild!, { key: "f", metaKey: true })
    const input = screen.getByPlaceholderText("Find in terminal…") as HTMLInputElement
    expect(input.value).toBe("selected phrase")
    fireEvent.change(input, { target: { value: "missing" } })
    expect(screen.getByRole("status").textContent).toBe("No matches")
    const focusBefore = h.terminals[0]!.focus.mock.calls.length
    view.rerender(<XtermView terminalId="t1" active={false} />)
    expect(screen.queryByPlaceholderText("Find in terminal…")).toBeNull()
    expect(h.terminals[0]?.focus).toHaveBeenCalledTimes(focusBefore)
    view.unmount()
    expect(h.searches[0]?.dispose).toHaveBeenCalledOnce()
  })

  it("repaints matches after a theme change without replacing the terminal or resetting its query", () => {
    const view = render(<XtermView terminalId="t1" />)
    fireEvent.keyDown(view.container.firstElementChild!, { key: "f", metaKey: true })
    fireEvent.change(screen.getByPlaceholderText("Find in terminal…"), { target: { value: "needle" } })
    const before = h.searches[0]!.findNext.mock.calls.at(-1)![1]
    h.palette = { background: "#ffffff", yellow: "#996600" }
    view.rerender(<XtermView terminalId="t1" />)
    const after = h.searches[0]!.findNext.mock.calls.at(-1)![1]
    expect(after.decorations.matchBackground).not.toBe(before.decorations.matchBackground)
    expect(h.terminals).toHaveLength(1)
    expect((screen.getByPlaceholderText("Find in terminal…") as HTMLInputElement).value).toBe("needle")
  })
})
