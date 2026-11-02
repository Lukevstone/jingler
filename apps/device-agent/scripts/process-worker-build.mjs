import { resolve } from "node:path"

/**
 * esbuild options for the subagent process worker, shared with the patch test
 * so it exercises the shipped bundle. `PI_BUNDLED_NODE` switches pi's extension
 * loader to its embedded modules: without it the loader resolves `typebox` and
 * `@earendil-works/*` next to the worker file, where no node_modules exists, so
 * every child extension (brokered tools, Claude CLI provider) fails to load.
 * @param {string} root
 * @param {string} outfile
 * @returns {import("esbuild").BuildOptions}
 */
export const processWorkerBuildOptions = (root, outfile) => ({
  entryPoints: [resolve(root, "node_modules/pi-subagents/src/runs/shared/process-child-session-worker.js")],
  bundle: true,
  platform: "node",
  mainFields: ["module", "main"],
  format: "esm",
  target: "node24",
  outfile,
  define: { PI_BUNDLED_NODE: "true" },
  inject: [resolve(root, "apps/device-agent/src/bundled-oauth.ts")],
  banner: {
    js: "import { createRequire as __jinglerCreateRequire } from \"node:module\"; const require = __jinglerCreateRequire(import.meta.url);"
  }
})
