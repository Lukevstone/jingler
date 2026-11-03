import type { BrowserControlSessionPortShape } from "./browser-control-port.js"

/** A do-nothing session port for tests; override only the ops a test exercises. */
export const stubBrowserSessionPort = (
  over: Partial<BrowserControlSessionPortShape> = {}
): BrowserControlSessionPortShape => ({
  navigate: async () => {},
  screenshot: async () => ({ pngBase64: "AAAA" }),
  click: async () => {},
  type: async () => {},
  readText: async () => ({ text: "" }),
  evaluate: async () => ({ result: "" }),
  waitForSelector: async () => {},
  hover: async () => {},
  pressKey: async () => {},
  scroll: async () => {},
  selectOption: async () => {},
  pageInfo: async () => ({ url: "", title: "" }),
  goBack: async () => {},
  reload: async () => {},
  snapshot: async () => ({ elements: [] }),
  networkRequests: async () => [],
  networkRequestDetail: async () => {
    throw new Error("not stubbed")
  },
  consoleLogs: async () => [],
  ...over
})
