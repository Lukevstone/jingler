import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SessionHeaderIdentity } from "./session-header-identity.js"

afterEach(cleanup)

describe("SessionHeaderIdentity", () => {
  it("renders link chips without the redundant title or branch", () => {
    render(<SessionHeaderIdentity chips={[{ id: "issue", label: "LIN-482", title: "Open", onOpen: vi.fn() }]} />)
    expect(screen.getByTestId("header-link-issue").textContent).toBe("LIN-482")
    expect(screen.queryByTestId("header-branch")).toBeNull()
  })
  it("hides missing chips", () => {
    render(<SessionHeaderIdentity chips={[]} />)
    expect(screen.queryByTestId("header-link-issue")).toBeNull()
  })
})
