import { Effect } from "effect"
import type { StreamEvent } from "@jingler/core"
import { describe, expect, it } from "vitest"
import { ToolRegistry } from "../tools/tool-registry.js"
import { createJinglerControlTools } from "./pi-jingler-tools.js"
import type { AgentRuntimeContext } from "./agent-runtime.js"
import { CONFIRM_PLAN, MAX_WORK_MODE_SWITCHES, registerWorkModeTool } from "./work-mode-tool.js"

const setup = (opts: { approved?: boolean; auto?: boolean; autoSwitch?: boolean; answer?: string; role?: "conversation" | "plan"; mode?: "plan" | "auto" } = {}) => {
  const events: StreamEvent[] = []
  const asked: string[] = []
  let entered = 0
  let switches = 0
  const context = {
    publishEvent: (e: StreamEvent) => Effect.sync(() => { events.push(e) }),
    askQuestion: (request: { questions: ReadonlyArray<{ question: string }> }) => Effect.sync(() => {
      asked.push(request.questions[0]!.question)
      return [{ selected: opts.answer === undefined ? [] : [opts.answer], other: null }]
    }),
    planning: { planApproved: () => opts.approved === true, enterPlanning: async () => { entered++ } },
    workModeHost: {
      autoSwitch: opts.autoSwitch ?? true,
      approvalIsAuto: () => opts.auto === true,
      reserveSwitch: () => switches < MAX_WORK_MODE_SWITCHES && ++switches > 0
    }
  } as unknown as AgentRuntimeContext
  const registry = new ToolRegistry()
  registerWorkModeTool(registry, context)
  const run = (mode: "plan" | "build") =>
    Effect.runPromise(registry.execute({
      id: "jingler_set_work_mode", arguments: { mode, reason: "r" },
      role: opts.role ?? "conversation", mode: opts.mode ?? "auto"
    }))
  return { events, asked, entered: () => entered, run }
}

describe("jingler_set_work_mode", () => {
  it("plan while already in plan is a no-op that never asks", async () => {
    const f = setup({ autoSwitch: false, mode: "plan" })
    const result = await f.run("plan")
    expect(result.status).toBe("success")
    expect(JSON.stringify(result.value)).toContain("unchanged")
    expect(f.asked).toEqual([])
    expect(f.events).toEqual([])
  })

  it("build needs approved plan", async () => {
    const { events, run } = setup()
    const result = await run("build")
    expect(result.status).toBe("error")
    expect(result.error?.message).toContain("plannotator_submit_plan")
    expect(events).toEqual([])
    expect((await setup({ approved: true }).run("build")).status).toBe("success")
  })

  it("auto approval allows build", async () => {
    expect((await setup({ auto: true }).run("build")).status).toBe("success")
  })

  it("rate limited per turn", async () => {
    const { run } = setup({ auto: true })
    expect((await run("plan")).status).toBe("success")
    expect((await run("build")).status).toBe("success")
    expect((await run("plan")).status).toBe("error")
  })

  it("without Auto, entering plan asks and switches on confirm", async () => {
    const f = setup({ autoSwitch: false, answer: CONFIRM_PLAN })
    expect((await f.run("plan")).status).toBe("success")
    expect(f.asked).toEqual(["Switch to plan mode? r"])
    expect(f.entered()).toBe(1)
    expect(f.events).toEqual([{ _tag: "WorkModeChanged", workMode: "plan" }])
  })

  it("without Auto, a declined switch leaves the mode alone", async () => {
    const f = setup({ autoSwitch: false, answer: "Stay in build" })
    const result = await f.run("plan")
    expect(result.status).toBe("success")
    expect(JSON.stringify(result.value)).toContain("declined")
    expect(f.entered()).toBe(0)
    expect(f.events).toEqual([])
  })

  it("with Auto, entering plan does not ask", async () => {
    const f = setup()
    await f.run("plan")
    expect(f.asked).toEqual([])
    expect(f.entered()).toBe(1)
  })

  it("registered whenever the turn has a work-mode host", () => {
    const ctx = { publishEvent: () => Effect.void, registerBackgroundStop: () => Effect.void, canUseTool: () => Effect.succeed("allow"), askQuestion: () => Effect.succeed([]) } as unknown as AgentRuntimeContext
    const ids = createJinglerControlTools(ctx).capabilitiesFor("conversation", "auto").map((c) => c.id)
    expect(ids).not.toContain("jingler_set_work_mode")
    const on = createJinglerControlTools({ ...ctx, workModeHost: { autoSwitch: false, approvalIsAuto: () => false, reserveSwitch: () => true } })
    expect(on.capabilitiesFor("conversation", "plan").map((c) => c.id)).toContain("jingler_set_work_mode")
  })
})
