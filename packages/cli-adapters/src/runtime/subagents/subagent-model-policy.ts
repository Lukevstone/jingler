import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent"

export const SUBAGENT_MODEL_POLICY_NAME = "jingler-subagent-model-policy"
export const SUBAGENT_MODEL_POLICY_PATH = `<inline:${SUBAGENT_MODEL_POLICY_NAME}>`

/**
 * Remove every `model` key from a `subagent` call's input, at any depth
 * (`model`, `tasks[].model`, `chain[].parallel[].model`, workflow `args`).
 * Models pick stale ids from training (`claude-sonnet-4-6`); the operator's
 * subagent settings are written into each profile and must always win.
 */
export const stripSubagentModels = (value: unknown): void => {
  if (Array.isArray(value)) {
    for (const item of value) stripSubagentModels(item)
    return
  }
  if (typeof value !== "object" || value === null) return
  const record = value as Record<string, unknown>
  delete record.model
  for (const child of Object.values(record)) stripSubagentModels(child)
}

export const subagentModelPolicy: InlineExtension = {
  name: SUBAGENT_MODEL_POLICY_NAME,
  factory: (pi: ExtensionAPI) => {
    pi.on("tool_call", (event) => {
      if (event.toolName === "subagent") stripSubagentModels(event.input)
    })
  }
}
