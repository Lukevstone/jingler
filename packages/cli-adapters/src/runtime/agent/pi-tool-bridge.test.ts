import { Schema } from "effect"
import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"
import {
  ToolRegistry,
} from "../tools/tool-registry.js"
import { registerWorkspaceInspectionTools } from "../tools/workspace-tools.js"
import { inactiveRuntimeActivity, type AgentRuntimeContext } from "./agent-runtime.js"
import { createPiTools, parseStringifiedArguments } from "./pi-tool-bridge.js"
import { executeRegistryTool } from "./registry-tool-bridge.js"

const spec = {
  role: "conversation",
  mode: "ask"
} as const

const mutationRegistry = (
  execute: () => Promise<unknown>,
  denied: () => Effect.Effect<void> = () => Effect.void
): ToolRegistry => {
  const registry = new ToolRegistry({
    observer: {
      started: () => Effect.succeed({ cwd: "/workspace", tree: "tree-before" }),
      settled: (_request, _risk, _state, _result) =>
        Effect.succeed({
          id: "set-1",
          callId: "call-1",
          changes: [],
          totals: { added: 0, removed: 0 },
          authoritative: true,
          reconciledAt: "2026-08-10T00:00:00.000Z"
        }),
      denied
    }
  })
  registry.register({
    id: "workspace_edit",
    version: "1",
    description: "Edit a file.",
    input: Schema.Struct({ path: Schema.String }),
    risk: "mutate",
    roles: ["conversation"],
    modes: ["ask"],
    timeoutMs: 1_000,
    outputBudget: 1_000,
    cancellable: true,
    idempotency: "keyed",
    execute
  })
  return registry
}

describe("pi tool bridge", () => {
  it("gates mutation tools and executes through the Effect registry", async () => {
    const execute = vi.fn(async () => ({ changed: true }))
    const canUseTool = vi.fn(() => Effect.succeed("allow" as const))
    const registry = mutationRegistry(execute)
    const context: AgentRuntimeContext = {
      ...inactiveRuntimeActivity,
      canUseTool,
      askQuestion: () => Effect.succeed([]),
    }
    const [tool] = createPiTools(registry, spec, context)

    expect(tool?.parameters).toMatchObject({
      type: "object",
      required: ["path"],
      properties: { path: { type: "string" } }
    })

    const result = await tool?.execute(
      "call-1",
      { path: "src/a.ts" },
      undefined,
      undefined,
      {} as never
    )
    expect(canUseTool).toHaveBeenCalledWith({ toolId: "workspace_edit", risk: "mutate" })
    expect(execute).toHaveBeenCalledOnce()
    expect(result?.details).toMatchObject({ status: "success" })
  })

  it("advertises no-argument tools as strict object schemas", () => {
    const registry = new ToolRegistry()
    registerWorkspaceInspectionTools(registry, "/workspace", {
      listFiles: () => Effect.succeed([]),
      executeReadOnly: (_cwd, program, args) => Effect.succeed({
        command: [program, ...args].join(" "), exitCode: 0, stdout: "", stderr: ""
      }),
      readTextFile: (_cwd, path) =>
        Effect.succeed({ path, text: "", language: null, revision: "rev-1" })
    })

    const tool = createPiTools(registry, spec, {
      ...inactiveRuntimeActivity,
      canUseTool: () => Effect.succeed("allow"),
      askQuestion: () => Effect.succeed([]),
    }).find(({ name }) => name === "workspace_list_files")

    expect(tool?.parameters).toEqual({
      type: "object",
      properties: { intent: expect.objectContaining({ type: "string" }) },
      required: [],
      additionalProperties: false
    })
  })
})

describe("pi tool permission denial", () => {
  it("does not execute a denied mutation", async () => {
    const execute = vi.fn(async () => null)
    const denied = vi.fn(() => Effect.void)
    const registry = mutationRegistry(execute, denied)
    const context: AgentRuntimeContext = {
      ...inactiveRuntimeActivity,
      canUseTool: () => Effect.succeed("deny"),
      askQuestion: () => Effect.succeed([]),
    }
    const [tool] = createPiTools(registry, spec, context)

    const result = await tool?.execute(
      "call-1",
      { path: "src/a.ts" },
      undefined,
      undefined,
      {} as never
    )
    expect(execute).not.toHaveBeenCalled()
    expect(denied).toHaveBeenCalledOnce()
    expect(result?.details).toMatchObject({
      status: "error",
      error: { code: "forbidden" }
    })
  })
})

describe("pi tool live work mode", () => {
  const planWriteRegistry = (execute: (input: unknown, context: { plan?: boolean }) => Promise<unknown>) => {
    const registry = new ToolRegistry({
      observer: {
        started: () => Effect.succeed({ cwd: "/workspace", tree: "tree-before" }),
        settled: () => Effect.succeed({
          id: "set-1", callId: "call-1", changes: [], totals: { added: 0, removed: 0 },
          authoritative: true, reconciledAt: "2026-08-10T00:00:00.000Z"
        })
      }
    })
    registry.register({
      id: "workspace_write",
      version: "1",
      description: "Write a file.",
      input: Schema.Struct({ path: Schema.String }),
      risk: "mutate",
      roles: ["conversation"],
      modes: ["auto", "plan"],
      timeoutMs: 1_000,
      outputBudget: 1_000,
      cancellable: true,
      idempotency: "keyed",
      execute
    })
    return registry
  }

  it("applies a mid-turn switch to plan instead of the turn's stale mode", async () => {
    const execute = vi.fn(async (_input: unknown, _context: { plan?: boolean }) => ({ ok: true }))
    const canUseTool = vi.fn(() => Effect.succeed("deny" as const))
    const [tool] = createPiTools(planWriteRegistry(execute), { role: "conversation", mode: "auto" }, {
      ...inactiveRuntimeActivity,
      canUseTool,
      askQuestion: () => Effect.succeed([]),
      liveMode: () => "plan"
    })

    const result = await tool?.execute("call-1", { path: "plans/x.md" }, undefined, undefined, {} as never)

    expect(canUseTool).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0]?.[1]).toMatchObject({ plan: true })
    expect(result?.details).toMatchObject({ status: "success" })
  })

  it("never widens a read-only run to the live mode", async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    const result = await executeRegistryTool({
      registry: planWriteRegistry(execute), spec: { role: "conversation", mode: "read-only" },
      context: { ...inactiveRuntimeActivity, canUseTool: () => Effect.succeed("allow"), askQuestion: () => Effect.succeed([]), liveMode: () => "auto" },
      id: "workspace_write", toolCallId: "call-1", parameters: { path: "a.md" }, signal: undefined, allowed: true, onUpdate: undefined
    })
    expect(execute).not.toHaveBeenCalled()
    expect(result.details).toMatchObject({ status: "error", error: { code: "forbidden" } })
  })
})

describe("parseStringifiedArguments", () => {
  const schema = {
    type: "object",
    properties: {
      id: { type: "string" },
      questions: { type: "array" },
      config: { anyOf: [{ type: "object" }, { type: "string" }] }
    }
  }

  it("parses a JSON-string array where the schema wants an array", () => {
    expect(parseStringifiedArguments(schema, { id: "q", questions: '[{"question":"x"}]' }))
      .toEqual({ id: "q", questions: [{ question: "x" }] })
  })

  it("coerces numeric strings where the schema wants an integer or number", () => {
    const numeric = { type: "object", properties: { limit: { type: "integer" }, ratio: { type: "number" }, name: { type: "string" } } }
    expect(parseStringifiedArguments(numeric, { limit: "6", ratio: "0.5", name: "7" }))
      .toEqual({ limit: 6, ratio: 0.5, name: "7" })
    // Not an integer, or not numeric at all: left for the validator to reject.
    expect(parseStringifiedArguments(numeric, { limit: "1.5" })).toEqual({ limit: "1.5" })
    expect(parseStringifiedArguments(numeric, { limit: "six" })).toEqual({ limit: "six" })
  })

  it("parses a JSON-string object where a union allows an object", () => {
    expect(parseStringifiedArguments(schema, { config: '{"a":1}' })).toEqual({ config: { a: 1 } })
  })

  it("leaves real strings, non-JSON and mismatched shapes alone", () => {
    const args = { id: "[1]", questions: "not json", config: "plain" }
    expect(parseStringifiedArguments(schema, args)).toBe(args)
    expect(parseStringifiedArguments(schema, { questions: '{"a":1}' })).toEqual({ questions: '{"a":1}' })
  })
})
