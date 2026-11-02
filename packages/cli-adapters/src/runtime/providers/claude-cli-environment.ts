import { nativeCliEnvironment, withMacCliPath } from "./native-cli-environment.js"

/**
 * Claude Code leaves its `Artifact` tool out of `-p` sessions unless opted in
 * (verified on 2.1.286). Auto-open is off because Jingler opens the link in its
 * own preview dock rather than the system browser.
 */
export const claudeArtifactEnvironment = {
  CLAUDE_CODE_ARTIFACT: "1",
  CLAUDE_CODE_ARTIFACT_AUTO_OPEN: "0"
} as const

/**
 * Built-ins Jingler re-enables beside its own MCP tools. `Read` is required:
 * when `--tools` omits it the CLI adds a Read deny rule that `Artifact` checks
 * before opening the page file, and an MCP read does not satisfy it.
 */
export const claudeBuiltinTools = ["Artifact", "Read"] as const

export const claudeToolArguments: ReadonlyArray<string> = [
  "--tools", claudeBuiltinTools.join(","),
  "--allowedTools", ["mcp__jingler__*", ...claudeBuiltinTools].join(" ")
]

export const withClaudeCliPath = (
  environment: NodeJS.ProcessEnv,
  platform = process.platform
): NodeJS.ProcessEnv => withMacCliPath(environment, platform)

export const claudeCliEnvironment = (
  environment: NodeJS.ProcessEnv,
  platform = process.platform
): NodeJS.ProcessEnv => ({
  ...nativeCliEnvironment(withClaudeCliPath(environment, platform)),
  ...claudeArtifactEnvironment
})
