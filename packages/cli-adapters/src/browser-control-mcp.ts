import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { BrowserControlSessionPortShape, BrowserNetworkEntry } from "./browser-control-port.js"

/** The MCP server the model sees; tools appear as `mcp__jingler-browser__*`. */
export const BROWSER_MCP_NAME = "jingler-browser"

type ToolResult = {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>
  isError?: boolean
}

const errText = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] })

/** Every tool reports a port failure as an `isError` result the model can read. */
const guard = async (f: () => Promise<ToolResult>): Promise<ToolResult> => {
  try {
    return await f()
  } catch (cause) {
    return { content: [{ type: "text", text: `Error: ${errText(cause)}` }], isError: true }
  }
}

/** One line per request keeps a 100-entry listing readable; details live in network_request_detail. */
export const formatNetworkLine = (e: BrowserNetworkEntry): string =>
  [
    `[${e.id}]`,
    e.method,
    e.failure ? `FAILED(${e.failure})` : e.status === null ? "pending" : String(e.status),
    e.resourceType,
    e.durationMs === null ? "" : `${Math.round(e.durationMs)}ms`,
    e.url
  ].filter(Boolean).join(" ")

const limitSchema = z.number().int().min(1).max(500).optional().describe("Max entries, newest kept (default 100).")
const clearSchema = z.boolean().optional().describe("Empty the buffer after reading, so the next read shows only new entries.")

/**
 * Build the browser-control MCP server used by the loopback HTTP service.
 *
 * Every tool drives Jingler's OWN embedded browser (the Preview dock's
 * `WebContentsView`) via the `BrowserControlPort`, so QA happens in the browser
 * the operator is watching rather than a headless Chrome the agent spawned. The
 * server itself runs in the Electron main process next to `PreviewViewService`;
 * external harnesses reach it through the authenticated, loopback-only
 * Streamable HTTP listener in `browser-control-mcp-service.ts`.
 */
export const buildBrowserControlMcp = (port: BrowserControlSessionPortShape) => {
  const server = new McpServer({
    name: BROWSER_MCP_NAME,
    version: "1.0.0"
  })

  server.registerTool(
    "navigate",
    {
      description:
        "Open a URL in Jingler's in-app browser (the one the operator is watching) and reveal it. Use this to QA a preview or dev-server URL — prefer it over the browser-use CLI, which spawns a browser the operator can't see. Network and console recording start with the browser, so open it before reproducing a bug.",
      inputSchema: {
        url: z.string().describe("An http(s) URL, e.g. the preview/dev-server address.")
      }
    },
    ({ url }) => guard(async () => {
      await port.navigate(url)
      return ok(`Opened ${url} in the in-app browser.`)
    })
  )

  server.registerTool(
    "screenshot",
    {
      description:
        "Take a PNG screenshot of the in-app browser — the viewport by default, the whole scrollable page, or one element. Full-page captures stop at 16384px tall and say so when they do.",
      inputSchema: {
        fullPage: z.boolean().optional().describe("Capture the entire scrollable page."),
        selector: z.string().optional().describe("Capture only the first element matching this CSS selector.")
      }
    },
    ({ fullPage, selector }) => guard(async () => {
      const { pngBase64, note } = await port.screenshot({
        ...(fullPage === undefined ? {} : { fullPage }),
        ...(selector === undefined ? {} : { selector })
      })
      const image = { type: "image" as const, data: pngBase64, mimeType: "image/png" }
      return { content: note === undefined ? [image] : [image, { type: "text", text: note }] }
    })
  )

  server.registerTool(
    "click",
    {
      description: "Click the first element matching a CSS selector in the in-app browser.",
      inputSchema: {
        selector: z.string().describe("A CSS selector, e.g. 'button[type=submit]'.")
      }
    },
    ({ selector }) => guard(async () => {
      await port.click(selector)
      return ok(`Clicked ${selector}.`)
    })
  )

  server.registerTool(
    "type",
    {
      description:
        "Type text into the first element matching a CSS selector (works on React-controlled inputs).",
      inputSchema: {
        selector: z.string().describe("A CSS selector for an input or textarea."),
        text: z.string().describe("The text to type.")
      }
    },
    ({ selector, text }) => guard(async () => {
      await port.type(selector, text)
      return ok(`Typed into ${selector}.`)
    })
  )

  server.registerTool(
    "hover",
    {
      description: "Move the pointer over the first element matching a CSS selector (opens hover menus and tooltips).",
      inputSchema: { selector: z.string().describe("A CSS selector.") }
    },
    ({ selector }) => guard(async () => {
      await port.hover(selector)
      return ok(`Hovered ${selector}.`)
    })
  )

  server.registerTool(
    "press_key",
    {
      description: "Press a keyboard key in the in-app browser, e.g. Enter, Escape, Tab, ArrowDown.",
      inputSchema: {
        key: z.string().describe("A key name: Enter, Escape, Tab, Backspace, ArrowUp/Down/Left/Right, or a single character."),
        selector: z.string().optional().describe("Focus this element first.")
      }
    },
    ({ key, selector }) => guard(async () => {
      await port.pressKey(key, selector)
      return ok(`Pressed ${key}${selector ? ` in ${selector}` : ""}.`)
    })
  )

  server.registerTool(
    "scroll",
    {
      description: "Scroll an element into view, or scroll the page by a number of pixels.",
      inputSchema: {
        selector: z.string().optional().describe("Scroll this element into view."),
        deltaY: z.number().optional().describe("Pixels to scroll the page vertically (negative scrolls up). Used when no selector is given.")
      }
    },
    ({ selector, deltaY }) => guard(async () => {
      await port.scroll({
        ...(selector === undefined ? {} : { selector }),
        ...(deltaY === undefined ? {} : { deltaY })
      })
      return ok(selector ? `Scrolled ${selector} into view.` : `Scrolled by ${deltaY ?? 0}px.`)
    })
  )

  server.registerTool(
    "select_option",
    {
      description: "Choose an option in a <select> element by its value or visible label.",
      inputSchema: {
        selector: z.string().describe("A CSS selector for the <select>."),
        value: z.string().describe("The option's value or visible text.")
      }
    },
    ({ selector, value }) => guard(async () => {
      await port.selectOption(selector, value)
      return ok(`Selected "${value}" in ${selector}.`)
    })
  )

  server.registerTool(
    "read_text",
    {
      description: "Read the visible text of the in-app browser's current page."
    },
    () => guard(async () => ok((await port.readText()).text))
  )

  server.registerTool(
    "snapshot",
    {
      description:
        "List the page's visible interactive elements (buttons, links, inputs…) with a CSS selector for each that click/type/hover accept. Use this instead of guessing selectors."
    },
    () => guard(async () => {
      const { elements } = await port.snapshot()
      if (elements.length === 0) return ok("No visible interactive elements.")
      return ok(
        elements
          .map((e) => `${e.selector}  <${e.tag}${e.role ? ` role=${e.role}` : ""}>${e.disabled ? " (disabled)" : ""} ${JSON.stringify(e.label)}`)
          .join("\n")
      )
    })
  )

  server.registerTool(
    "get_url",
    { description: "The in-app browser's current URL and page title." },
    () => guard(async () => {
      const { url, title } = await port.pageInfo()
      return ok(`${url}\n${title}`)
    })
  )

  server.registerTool(
    "back",
    { description: "Go back one page in the in-app browser's history." },
    () => guard(async () => {
      await port.goBack()
      return ok("Went back.")
    })
  )

  server.registerTool(
    "reload",
    { description: "Reload the in-app browser's current page." },
    () => guard(async () => {
      await port.reload()
      return ok("Reloaded.")
    })
  )

  server.registerTool(
    "evaluate",
    {
      description:
        "Evaluate a JavaScript expression in the in-app browser's page and return the result as a string.",
      inputSchema: {
        expression: z.string().describe("A JS expression, e.g. 'document.title'.")
      }
    },
    ({ expression }) => guard(async () => ok((await port.evaluate(expression)).result))
  )

  server.registerTool(
    "wait_for_selector",
    {
      description: "Wait until a CSS selector appears in the in-app browser's page, or time out.",
      inputSchema: {
        selector: z.string().describe("A CSS selector to wait for."),
        timeoutMs: z
          .number()
          .optional()
          .describe("Max wait in ms (default 10000, capped at 30000).")
      }
    },
    ({ selector, timeoutMs }) => guard(async () => {
      await port.waitForSelector(selector, timeoutMs ?? 10_000)
      return ok(`Found ${selector}.`)
    })
  )

  server.registerTool(
    "network_requests",
    {
      description:
        "List network requests the in-app browser made (like DevTools' Network tab), one per line: [id] METHOD STATUS TYPE DURATION URL. Pass an id to network_request_detail for headers and body.",
      inputSchema: {
        urlContains: z.string().optional().describe("Only URLs containing this text."),
        onlyFailed: z.boolean().optional().describe("Only failed requests and HTTP status >= 400."),
        resourceType: z.string().optional().describe("Only this type: Document, XHR, Fetch, Script, Stylesheet, Image, WebSocket…"),
        limit: limitSchema,
        clear: clearSchema
      }
    },
    (filter) => guard(async () => {
      const entries = await port.networkRequests(filter)
      return ok(entries.length === 0 ? "No matching requests recorded." : entries.map(formatNetworkLine).join("\n"))
    })
  )

  server.registerTool(
    "network_request_detail",
    {
      description: "One recorded request in full: request/response headers, post data and the response body.",
      inputSchema: { id: z.string().describe("The [id] from network_requests.") }
    },
    ({ id }) => guard(async () => {
      const { entry, body } = await port.networkRequestDetail(id)
      return ok(`${JSON.stringify(entry, null, 2)}\n\n--- response body ---\n${body ?? "(no body available)"}`)
    })
  )

  server.registerTool(
    "console_logs",
    {
      description:
        "Read the in-app browser's console output and uncaught exceptions (like DevTools' Console), oldest first.",
      inputSchema: {
        level: z.enum(["error", "warn", "info", "log", "debug"]).optional().describe("Only this level."),
        textContains: z.string().optional().describe("Only messages containing this text."),
        limit: limitSchema,
        clear: clearSchema
      }
    },
    (filter) => guard(async () => {
      const entries = await port.consoleLogs(filter)
      if (entries.length === 0) return ok("No matching console messages recorded.")
      return ok(
        entries
          .map((e) => `[${e.level}] ${e.source === "console" ? "" : `(${e.source}) `}${e.text}${e.url ? `  — ${e.url}` : ""}`)
          .join("\n")
      )
    })
  )

  return server
}
