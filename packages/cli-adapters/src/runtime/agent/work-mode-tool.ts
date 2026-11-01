import { Effect, Schema } from "effect"
import { INTERACTIVE_TOOL_TIMEOUT_MS, ToolError, codeReadModes, type ToolRegistry } from "../tools/tool-registry.js"
import type { AgentRuntimeContext } from "./agent-runtime.js"

export const MAX_WORK_MODE_SWITCHES = 2

export const CONFIRM_PLAN = "Switch to plan"

/** What `jingler_set_work_mode` needs from the turn. */
export interface WorkModeHost {
  /** Auto switching on: switch without asking. Off: the operator confirms entering plan. */
  readonly autoSwitch: boolean
  readonly approvalIsAuto: () => boolean
  /** Claims one of this turn's switches; false once the limit is spent. */
  readonly reserveSwitch: () => boolean
}

const assertCanSwitch = (context: AgentRuntimeContext, host: WorkModeHost, mode: "plan" | "build"): void => {
  if (mode === "build" && !host.approvalIsAuto() && context.planning?.planApproved?.() !== true) {
    throw new ToolError("forbidden", "Cannot switch to build: submit the plan with plannotator_submit_plan for approval first")
  }
  if (!host.reserveSwitch()) throw new ToolError("forbidden", "Work mode switch limit reached for this turn")
}

/** Asks the operator to enter plan; null when confirmed, otherwise the decline reason. */
const confirmPlan = async (context: AgentRuntimeContext, reason: string): Promise<string | null> => {
  const [answer] = await Effect.runPromise(context.askQuestion({
    id: "work-mode-plan",
    questions: [{
      header: "Plan mode",
      question: `Switch to plan mode? ${reason}`,
      options: [
        { label: CONFIRM_PLAN, description: "Investigate read-only and submit a plan for your approval before building." },
        { label: "Stay in build", description: "Keep building without a reviewed plan." }
      ],
      multiSelect: false
    }]
  }))
  return answer?.selected[0] === CONFIRM_PLAN ? null : (answer?.other ?? "Operator chose to stay in build")
}

export const registerWorkModeTool = (registry: ToolRegistry, context: AgentRuntimeContext): void => {
  registry.register({
    id: "jingler_set_work_mode",
    version: "1",
    description:
      "Switch this chat between Plan (read-only investigation) and Build. Enter plan before writing a plan or making large or risky changes; the operator may be asked to confirm and can decline. Leaving plan needs an approved plan: submit it with plannotator_submit_plan first. At most 2 switches per turn.",
    input: Schema.Struct({ mode: Schema.Literal("plan", "build"), reason: Schema.String }),
    risk: "read",
    roles: ["conversation", "plan", "plan-execution"],
    modes: codeReadModes,
    timeoutMs: INTERACTIVE_TOOL_TIMEOUT_MS,
    outputBudget: 16_000,
    cancellable: true,
    idempotency: "unsafe",
    execute: async ({ mode, reason }, { plan }) => {
      const host = context.workModeHost
      if (host === undefined) throw new ToolError("forbidden", "Work mode switching is unavailable for this chat")
      if (mode === "plan" && plan === true) return { status: "unchanged", mode, reason: "Already in plan mode" }
      assertCanSwitch(context, host, mode)
      if (mode === "plan" && !host.autoSwitch) {
        const declined = await confirmPlan(context, reason)
        if (declined !== null) return { status: "declined", mode: "build", reason: declined }
      }
      if (mode === "plan") await context.planning?.enterPlanning?.()
      await Effect.runPromise(context.publishEvent({ _tag: "WorkModeChanged", workMode: mode }))
      return { status: "switched", mode, reason }
    }
  })
}
