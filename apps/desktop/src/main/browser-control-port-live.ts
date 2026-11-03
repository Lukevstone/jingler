/**
 * The desktop implementation of `BrowserControlPort` (the interface lives in
 * `@jingler/cli-adapters`). It binds the agent-facing browser tools to the real
 * embedded browser by running each `PreviewViewService` op as a Promise.
 *
 * Split from the port definition on purpose: only this file imports Electron
 * (transitively, via `PreviewViewService`), so `cli-adapters` — which builds the
 * MCP server against the interface — never pulls the main bundle in.
 */
import { BrowserControlPort } from "@jingler/cli-adapters"
import { Effect, Layer } from "effect"
import { PreviewViewService } from "./preview-view.js"

export const BrowserControlPortLive = Layer.effect(
  BrowserControlPort,
  Effect.gen(function* () {
    const preview = yield* PreviewViewService
    // Each op has `R = never` once `preview` is captured, so `runPromise` is
    // safe; it rejects with the `BrowserControlError` the op fails with, which
    // the MCP tool handler surfaces to the model.
    return BrowserControlPort.of({
      forAgent: (sessionId, chatId) => ({
        navigate: (url) => Effect.runPromise(preview.controlNavigate(sessionId, chatId, url)),
        screenshot: (options) => Effect.runPromise(preview.controlScreenshot(sessionId, chatId, options)),
        hover: (selector) => Effect.runPromise(preview.controlHover(sessionId, chatId, selector)),
        pressKey: (key, selector) => Effect.runPromise(preview.controlPressKey(sessionId, chatId, key, selector)),
        scroll: (options) => Effect.runPromise(preview.controlScroll(sessionId, chatId, options)),
        selectOption: (selector, value) =>
          Effect.runPromise(preview.controlSelectOption(sessionId, chatId, selector, value)),
        pageInfo: () => Effect.runPromise(preview.controlPageInfo(sessionId, chatId)),
        goBack: () => Effect.runPromise(preview.controlGoBack(sessionId, chatId)),
        reload: () => Effect.runPromise(preview.controlReload(sessionId, chatId)),
        snapshot: () => Effect.runPromise(preview.controlSnapshot(sessionId, chatId)),
        networkRequests: (filter) => Effect.runPromise(preview.controlNetworkRequests(sessionId, chatId, filter)),
        networkRequestDetail: (id) => Effect.runPromise(preview.controlNetworkRequestDetail(sessionId, chatId, id)),
        consoleLogs: (filter) => Effect.runPromise(preview.controlConsoleLogs(sessionId, chatId, filter)),
        click: (selector) => Effect.runPromise(preview.controlClick(sessionId, chatId, selector)),
        type: (selector, text) =>
          Effect.runPromise(preview.controlType(sessionId, chatId, selector, text)),
        readText: () => Effect.runPromise(preview.controlReadText(sessionId, chatId)),
        evaluate: (expression) =>
          Effect.runPromise(preview.controlEvaluate(sessionId, chatId, expression)),
        waitForSelector: (selector, timeoutMs) =>
          Effect.runPromise(preview.controlWaitForSelector(sessionId, chatId, selector, timeoutMs))
      })
    })
  })
)
