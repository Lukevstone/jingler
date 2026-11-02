import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { SessionCheckout } from "@jingler/core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CheckoutSwitcher, checkoutLabel } from "./checkout-switcher.js"

afterEach(cleanup)

const api: SessionCheckout = { id: "primary", repo: "org/api", branch: "feat/x", prNumber: 12 }
const web: SessionCheckout = { id: "c2", repo: "org/web", branch: "feat/y", prNumber: null }

describe("CheckoutSwitcher", () => {
  it("renders nothing for a single-checkout session", () => {
    render(<CheckoutSwitcher checkouts={[api]} activeCheckoutId="primary" onSwitch={vi.fn()} />)
    expect(screen.queryByTestId("checkout-switcher")).toBeNull()
  })

  it("names the active repo and how many others are attached", () => {
    render(<CheckoutSwitcher checkouts={[api, web]} activeCheckoutId="c2" onSwitch={vi.fn()} />)
    expect(screen.getByTestId("checkout-switcher").textContent).toBe("web+1")
  })

  it("switches to the picked checkout", async () => {
    const onSwitch = vi.fn()
    render(<CheckoutSwitcher checkouts={[api, web]} activeCheckoutId="c2" onSwitch={onSwitch} />)
    fireEvent.click(screen.getByRole("button", { name: "Switch repository" }))
    fireEvent.click(await screen.findByText("api · feat/x"))
    expect(onSwitch).toHaveBeenCalledWith("primary")
  })

  it("labels a checkout by its repo name and branch", () => {
    expect(checkoutLabel(api)).toBe("api · feat/x")
  })
})
