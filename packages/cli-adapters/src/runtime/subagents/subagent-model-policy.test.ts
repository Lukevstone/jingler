import { describe, expect, it } from "vitest"
import { stripSubagentModels } from "./subagent-model-policy.js"

describe("stripSubagentModels", () => {
  it("drops every caller-supplied model so the configured profile model wins", () => {
    const input = {
      agent: "worker",
      model: "anthropic/claude-sonnet-4-6",
      task: "draw",
      args: { tasks: [{ agent: "worker", task: "a", model: "anthropic/claude-sonnet-4-6" }] },
      chain: [{ agent: "scout", parallel: [{ agent: "worker", task: "b", model: "x" }] }]
    }
    stripSubagentModels(input)
    expect(input).toEqual({
      agent: "worker",
      task: "draw",
      args: { tasks: [{ agent: "worker", task: "a" }] },
      chain: [{ agent: "scout", parallel: [{ agent: "worker", task: "b" }] }]
    })
  })
})
