import { describe, expect, it } from "vitest"
import { makeTextToolCallGuard } from "./claude-cli-text-tool-call.js"

const offered = new Set(["workspace_write", "command_execute"])
const typed = (body: string, name = "command_execute") =>
  `<jingler-tool-call id="abc" name="${name}">\n${body}\n</jingler-tool-call>`

/** Feed text in small deltas, the way the stream delivers it. */
const scan = (input: string, size = 7) => {
  const guard = makeTextToolCallGuard(offered)
  let text = ""
  for (let at = 0; at < input.length; at += size) {
    const result = guard.push(input.slice(at, at + size))
    text += result.text
    if (result.call !== null) return { text, call: result.call }
  }
  return { text: text + guard.flush(), call: null }
}

describe("makeTextToolCallGuard", () => {
  it.each([
    ["on its own line", "Running it.\n\n"],
    ["after a <br>", "Running it.\n\n<br>"],
    ["straight after a sentence", "Running it."]
  ])("catches a call %s", (_label, before) => {
    const { text, call } = scan(`${before}${typed('{"command":"ls"}')}\ntrailing`)
    expect(text.replace("<br>", "")).toBe(before.replace("<br>", ""))
    expect(text).not.toContain("<br>")
    expect(call).toMatchObject({ name: "command_execute", arguments: { command: "ls" } })
  })

  it("reads the parameter form the model sometimes writes", () => {
    const body = '<jingler-parameter name="path">a.lua</jingler-parameter>\n<jingler-parameter name="content">x = 1</jingler-parameter>'
    expect(scan(typed(body, "workspace_write")).call).toMatchObject({
      name: "workspace_write",
      arguments: { path: "a.lua", content: "x = 1" }
    })
  })

  it("accepts a <br> between the tag and its JSON", () => {
    const input = '<jingler-tool-call id="a" name="command_execute">\n<br>{"command":"ls"}\n</jingler-tool-call>'
    expect(scan(input).call).toMatchObject({ arguments: { command: "ls" } })
  })

  it.each([
    ["in a code fence", `\`\`\`\n${typed('{"command":"ls"}')}\n\`\`\``],
    ["in backticks", `Here: \`${typed('{"command":"ls"}')}\``],
    ["mid-sentence", `The tag ${typed('{"command":"ls"}')} is replay markup`],
    ["for a tool pi did not offer", typed('{"command":"ls"}', "rm_everything")],
    ["with arguments that do not parse", typed("not json")],
    ["with no closing tag", '<jingler-tool-call id="a" name="command_execute">\n{"command":'],
    ["in a tilde fence", `~~~\n${typed('{"command":"ls"}')}\n~~~`],
    ["in an indented fence", `  \`\`\`\n${typed('{"command":"ls"}')}\n  \`\`\``],
    ["in a double-backtick span", `Here: \`\`${typed('{"command":"ls"}')}\`\``],
    ["in a multiline code span", `Here: \`\n${typed('{"command":"ls"}')}\n\``],
    ["in an indented code block", `Example:\n\n    ${typed('{"command":"ls"}')}`]
  ])("leaves text untouched %s", (_label, input) => {
    expect(scan(input)).toEqual({ text: input, call: null })
  })

  it.each([1, 7, 1000])("reads past both delimiters inside a JSON string, %i characters at a time", (size) => {
    const content = `<jingler-tool-call id="a" name="x">\n</jingler-tool-call> "quoted" \\`
    const body = JSON.stringify({ path: "docs/markup.md", content })
    const { text, call } = scan(typed(body, "workspace_write"), size)
    expect(text).toBe("")
    expect(call).toMatchObject({ name: "workspace_write", arguments: { path: "docs/markup.md", content } })
  })

  it("does not treat quotes in a parameter value as a JSON string", () => {
    const body = `<jingler-parameter name="path">a.lua</jingler-parameter>\n<jingler-parameter name="content">say "hi</jingler-parameter>`
    expect(scan(typed(body, "workspace_write")).call).toMatchObject({
      arguments: { path: "a.lua", content: 'say "hi' }
    })
  })

  it("releases the reply straight away after a header for a tool pi did not offer", () => {
    const guard = makeTextToolCallGuard(offered)
    const header = '<jingler-tool-call id="a" name="rm_everything">'
    expect(guard.push(header).text).toBe(header)
    expect(guard.push("\nthe rest of the reply").text).toBe("\nthe rest of the reply")
  })

  it("still catches a real call after an unoffered header", () => {
    const { call } = scan(`<jingler-tool-call id="a" name="rm_everything">\n\n${typed('{"command":"real"}')}`)
    expect(call).toMatchObject({ arguments: { command: "real" } })
  })

  it("does not rescan a long call body on every delta", () => {
    const guard = makeTextToolCallGuard(offered)
    guard.push('<jingler-tool-call id="a" name="workspace_write">\n{"path":"a","content":"')
    const started = performance.now()
    for (let index = 0; index < 20_000; index += 1) guard.push("x".repeat(50))
    const { call } = guard.push('"}\n</jingler-tool-call>')
    expect(call).toMatchObject({ name: "workspace_write" })
    expect(performance.now() - started).toBeLessThan(2_000)
  })

  it("still catches a real call after quoted markup", () => {
    const quoted = `\`${typed('{"command":"quoted"}')}\`\n\n`
    const { text, call } = scan(`${quoted}${typed('{"command":"real"}')}`)
    expect(text).toBe(quoted)
    expect(call).toMatchObject({ arguments: { command: "real" } })
  })

  it("releases text it held back that turned out to be nothing", () => {
    const guard = makeTextToolCallGuard(offered)
    expect(guard.push("a < b <").text).toBe("a < b ")
    expect(guard.push("br>\n").text).toBe("")
    expect(guard.flush()).toBe("<br>\n")
  })
})
