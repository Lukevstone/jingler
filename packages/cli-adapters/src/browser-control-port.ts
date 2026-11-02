import { Context } from "effect"

/**
 * The seam between the agent's browser-control MCP (this package) and the main
 * process's embedded browser (`PreviewViewService`, in `apps/desktop`).
 *
 * The MCP tool handlers are plain async functions, so this port speaks Promises
 * rather than Effects: the desktop impl runs each `PreviewViewService` op with
 * `Effect.runPromise` and lets it reject with the underlying `BrowserControlError`.
 * Defined here (not in the desktop app) so `AgentRunner` can build the MCP
 * server against the interface without importing the Electron main bundle.
 */
export interface BrowserScreenshotOptions {
  /** Capture the whole scrollable page instead of the viewport. */
  readonly fullPage?: boolean
  /** Capture only the first element matching this selector. */
  readonly selector?: string
}

export interface BrowserNetworkEntry {
  readonly id: string
  readonly method: string
  readonly url: string
  readonly resourceType: string
  readonly status: number | null
  readonly statusText: string
  readonly mimeType: string
  /** Chromium's error text when the request never completed. */
  readonly failure: string | null
  readonly durationMs: number | null
  readonly encodedBytes: number | null
  readonly requestHeaders: Readonly<Record<string, string>>
  readonly responseHeaders: Readonly<Record<string, string>>
  readonly postData: string | null
}

export interface BrowserNetworkFilter {
  readonly urlContains?: string
  /** Failed requests and HTTP status >= 400 only. */
  readonly onlyFailed?: boolean
  readonly resourceType?: string
  readonly limit?: number
  /** Empty the buffer after reading. */
  readonly clear?: boolean
}

export type BrowserConsoleLevel = "error" | "warn" | "info" | "log" | "debug"

export interface BrowserConsoleEntry {
  readonly level: BrowserConsoleLevel
  /** `console`, `exception`, or a Chromium log source (`network`, `security`…). */
  readonly source: string
  readonly text: string
  readonly url: string | null
  readonly timestamp: number
}

export interface BrowserConsoleFilter {
  readonly level?: BrowserConsoleLevel
  readonly textContains?: string
  readonly limit?: number
  readonly clear?: boolean
}

export interface BrowserSnapshotElement {
  readonly selector: string
  readonly tag: string
  readonly role: string | null
  readonly label: string
  readonly disabled: boolean
}

export interface BrowserControlSessionPortShape {
  /** Open a URL (http/https) in the in-app browser and reveal the dock. */
  readonly navigate: (url: string) => Promise<void>
  /** PNG screenshot of the viewport, the full page, or one element, base64-encoded. */
  readonly screenshot: (options?: BrowserScreenshotOptions) => Promise<{ readonly pngBase64: string }>
  /** Click the first element matching a CSS selector. */
  readonly click: (selector: string) => Promise<void>
  /** Type text into the first element matching a CSS selector. */
  readonly type: (selector: string, text: string) => Promise<void>
  /** The page's visible text. */
  readonly readText: () => Promise<{ readonly text: string }>
  /** Evaluate a JS expression in the page; returns its string result. */
  readonly evaluate: (expression: string) => Promise<{ readonly result: string }>
  /** Resolve once a selector appears, or reject after `timeoutMs`. */
  readonly waitForSelector: (selector: string, timeoutMs: number) => Promise<void>
  /** Move the pointer over the first element matching a selector. */
  readonly hover: (selector: string) => Promise<void>
  /** Press a key (e.g. `Enter`, `Escape`, `ArrowDown`), optionally focusing a selector first. */
  readonly pressKey: (key: string, selector?: string) => Promise<void>
  /** Scroll an element into view, or scroll the page by `deltaY` pixels. */
  readonly scroll: (options: { readonly selector?: string; readonly deltaY?: number }) => Promise<void>
  /** Pick an `<option>` (by value or visible label) in a `<select>`. */
  readonly selectOption: (selector: string, value: string) => Promise<void>
  /** The current URL and document title. */
  readonly pageInfo: () => Promise<{ readonly url: string; readonly title: string }>
  readonly goBack: () => Promise<void>
  readonly reload: () => Promise<void>
  /** Visible interactive elements with a selector the other tools can use. */
  readonly snapshot: () => Promise<{ readonly elements: ReadonlyArray<BrowserSnapshotElement> }>
  /** Recorded network requests, newest last. */
  readonly networkRequests: (filter: BrowserNetworkFilter) => Promise<ReadonlyArray<BrowserNetworkEntry>>
  /** One request with its response body (text, or a note when binary/evicted). */
  readonly networkRequestDetail: (
    id: string
  ) => Promise<{ readonly entry: BrowserNetworkEntry; readonly body: string | null }>
  /** Recorded console output and uncaught exceptions, newest last. */
  readonly consoleLogs: (filter: BrowserConsoleFilter) => Promise<ReadonlyArray<BrowserConsoleEntry>>
}

export interface BrowserControlPortShape {
  /** Bind every operation to one top-level agent before it reaches Electron. */
  readonly forAgent: (sessionId: string, chatId: string) => BrowserControlSessionPortShape
}

export class BrowserControlPort extends Context.Tag("@jingler/BrowserControlPort")<
  BrowserControlPort,
  BrowserControlPortShape
>() {}
