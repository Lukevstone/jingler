// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { snapshotScript } from "./browser-page-scripts.js"

type Element = { selector: string; label: string }

describe("snapshotScript", () => {
  it("never returns typed values as labels, but keeps button values and <label> text", () => {
    document.body.innerHTML = `
      <input type="password" id="pw">
      <label for="email">Email address</label><input id="email">
      <input type="submit" value="Sign in">`
    ;(document.getElementById("pw") as HTMLInputElement).value = "hunter2"
    ;(document.getElementById("email") as HTMLInputElement).value = "me@secret.dev"
    // jsdom has no layout; give every element a box so the visibility filter passes.
    HTMLElement.prototype.getBoundingClientRect = () => ({ width: 10, height: 10 }) as DOMRect
    // jsdom lacks CSS.escape; the ids here need no escaping.
    globalThis.CSS ??= { escape: (s: string) => s } as typeof CSS
    const elements = (0, eval)(snapshotScript) as Array<Element>
    const json = JSON.stringify(elements)
    expect(json).not.toContain("hunter2")
    expect(json).not.toContain("me@secret.dev")
    expect(elements.map((e) => e.label)).toStrictEqual(["", "Email address", "Sign in"])
  })
})
