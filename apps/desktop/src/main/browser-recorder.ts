/**
 * Records one browser view's network and console activity from Chrome DevTools
 * Protocol events, so the agent can read them like DevTools' Network and
 * Console tabs. Pure: the caller attaches `webContents.debugger` and feeds every
 * `message` event to `handle`; `send` is only used to fetch response bodies.
 */
import type {
  BrowserConsoleEntry,
  BrowserConsoleFilter,
  BrowserConsoleLevel,
  BrowserNetworkEntry,
  BrowserNetworkFilter
} from "@jingler/cli-adapters"

export const MAX_NETWORK_ENTRIES = 500
export const MAX_CONSOLE_ENTRIES = 1_000
const MAX_BODY_CHARS = 100_000
const DEFAULT_LIMIT = 100

// The CDP fields we read. Chromium owns the shape; we only narrow what we use.
interface CdpRequest { url: string; method: string; headers: Record<string, string>; postData?: string }
interface CdpResponse { status: number; statusText: string; headers: Record<string, string>; mimeType: string }
interface RemoteObject { value?: unknown; description?: string; unserializableValue?: string }

type Mutable<T> = { -readonly [K in keyof T]: T[K] }
type NetworkRecord = Mutable<BrowserNetworkEntry> & { cdpId: string; startedAt: number }

const levelOfConsoleType = (type: string): BrowserConsoleLevel =>
  type === "error" || type === "assert" ? "error"
    : type === "warning" ? "warn"
      : type === "info" ? "info"
        : type === "debug" ? "debug"
          : "log"

const levelOfLogEntry = (level: string): BrowserConsoleLevel =>
  level === "error" ? "error" : level === "warning" ? "warn" : level === "verbose" ? "debug" : "info"

const remoteText = (arg: RemoteObject): string =>
  arg.value === undefined
    ? arg.unserializableValue ?? arg.description ?? "undefined"
    : typeof arg.value === "string" ? arg.value : JSON.stringify(arg.value)

const takeLast = <T>(items: ReadonlyArray<T>, limit: number | undefined): ReadonlyArray<T> =>
  items.slice(-Math.max(1, limit ?? DEFAULT_LIMIT))

const TEXT_MIME = /^text\/|json|javascript|xml|html|svg|x-www-form-urlencoded/u

const decodeBody = ({ body, base64Encoded }: { body: string; base64Encoded: boolean }, mime: string): string => {
  if (base64Encoded && !TEXT_MIME.test(mime)) {
    return `(binary ${mime || "body"}, ${Math.round((body.length * 3) / 4)} bytes)`
  }
  const text = base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body
  return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}\n… (truncated, ${text.length} chars)` : text
}

export const createBrowserRecorder = (send: (method: string, params?: object) => Promise<unknown>) => {
  const requests = new Map<string, NetworkRecord>()
  let consoleEntries: Array<BrowserConsoleEntry> = []
  let redirects = 0

  const pushRequest = (record: NetworkRecord) => {
    requests.set(record.id, record)
    if (requests.size > MAX_NETWORK_ENTRIES) requests.delete(requests.keys().next().value!)
  }
  const pushConsole = (entry: BrowserConsoleEntry) => {
    consoleEntries.push(entry)
    if (consoleEntries.length > MAX_CONSOLE_ENTRIES) consoleEntries = consoleEntries.slice(-MAX_CONSOLE_ENTRIES)
  }
  const finish = (record: NetworkRecord, timestamp: number) => {
    record.durationMs = (timestamp - record.startedAt) * 1_000
  }

  type Params = Record<string, unknown>
  const onRequest = (p: Params) => {
    const id = p.requestId as string
    const timestamp = p.timestamp as number
    const prior = requests.get(id)
    const redirect = p.redirectResponse as CdpResponse | undefined
    if (prior && redirect) {
      // Chromium reuses the requestId across redirects; keep each hop.
      requests.delete(id)
      finish(prior, timestamp)
      pushRequest({
        ...prior,
        id: `${id}#r${++redirects}`,
        status: redirect.status,
        statusText: redirect.statusText,
        responseHeaders: redirect.headers,
        mimeType: redirect.mimeType
      })
    }
    const request = p.request as CdpRequest
    pushRequest({
      id,
      cdpId: id,
      startedAt: timestamp,
      method: request.method,
      url: request.url,
      resourceType: (p.type as string | undefined) ?? "Other",
      status: null,
      statusText: "",
      mimeType: "",
      failure: null,
      durationMs: null,
      encodedBytes: null,
      requestHeaders: request.headers,
      responseHeaders: {},
      postData: request.postData ?? null
    })
  }

  const withRecord = (f: (record: NetworkRecord, p: Params) => void) => (p: Params) => {
    const record = requests.get(p.requestId as string)
    if (record) f(record, p)
  }

  const handlers: Readonly<Record<string, (p: Params) => void>> = {
    "Network.requestWillBeSent": onRequest,
    "Network.responseReceived": withRecord((record, p) => {
      const response = p.response as CdpResponse
      record.status = response.status
      record.statusText = response.statusText
      record.responseHeaders = response.headers
      record.mimeType = response.mimeType
      if (typeof p.type === "string") record.resourceType = p.type
    }),
    "Network.loadingFinished": withRecord((record, p) => {
      finish(record, p.timestamp as number)
      record.encodedBytes = p.encodedDataLength as number
    }),
    "Network.loadingFailed": withRecord((record, p) => {
      finish(record, p.timestamp as number)
      record.failure = p.canceled === true ? "canceled" : (p.errorText as string)
    }),
    "Runtime.consoleAPICalled": (p) => {
      const args = (p.args as Array<RemoteObject> | undefined) ?? []
      const frame = (p.stackTrace as { callFrames?: Array<{ url?: string }> } | undefined)?.callFrames?.[0]
      pushConsole({
        level: levelOfConsoleType(p.type as string),
        source: "console",
        text: args.map(remoteText).join(" "),
        url: frame?.url || null,
        timestamp: p.timestamp as number
      })
    },
    "Runtime.exceptionThrown": (p) => {
      const details = p.exceptionDetails as { text: string; url?: string; exception?: RemoteObject }
      pushConsole({
        level: "error",
        source: "exception",
        text: details.exception?.description ?? details.text,
        url: details.url ?? null,
        timestamp: p.timestamp as number
      })
    },
    "Log.entryAdded": (p) => {
      const entry = p.entry as { source: string; level: string; text: string; url?: string; timestamp: number }
      pushConsole({
        level: levelOfLogEntry(entry.level),
        source: entry.source,
        text: entry.text,
        url: entry.url ?? null,
        timestamp: entry.timestamp
      })
    }
  }

  const handle = (method: string, params: unknown): void => {
    handlers[method]?.(params as Params)
  }

  const publicEntry = ({ cdpId: _c, startedAt: _s, ...entry }: NetworkRecord): BrowserNetworkEntry => entry

  const networkRequests = (filter: BrowserNetworkFilter): ReadonlyArray<BrowserNetworkEntry> => {
    const matches = [...requests.values()].filter((r) =>
      (filter.urlContains === undefined || r.url.includes(filter.urlContains)) &&
      (filter.resourceType === undefined || r.resourceType.toLowerCase() === filter.resourceType.toLowerCase()) &&
      (!filter.onlyFailed || r.failure !== null || (r.status ?? 0) >= 400)
    )
    if (filter.clear) requests.clear()
    return takeLast(matches, filter.limit).map(publicEntry)
  }

  const networkRequestDetail = async (id: string) => {
    const record = requests.get(id)
    if (!record) throw new Error(`No recorded request with id ${id} (it may have been cleared or evicted)`)
    const entry = publicEntry(record)
    // A redirect hop has no body of its own; neither does a failed request.
    if (record.id !== record.cdpId || record.failure !== null) return { entry, body: null }
    try {
      const response = (await send("Network.getResponseBody", { requestId: record.cdpId })) as {
        body: string
        base64Encoded: boolean
      }
      return { entry, body: decodeBody(response, record.mimeType) }
    } catch (cause) {
      return { entry, body: `(body unavailable: ${cause instanceof Error ? cause.message : String(cause)})` }
    }
  }

  const consoleLogs = (filter: BrowserConsoleFilter): ReadonlyArray<BrowserConsoleEntry> => {
    const matches = consoleEntries.filter((e) =>
      (filter.level === undefined || e.level === filter.level) &&
      (filter.textContains === undefined || e.text.includes(filter.textContains))
    )
    if (filter.clear) consoleEntries = []
    return takeLast(matches, filter.limit)
  }

  return { handle, networkRequests, networkRequestDetail, consoleLogs }
}

export type BrowserRecorder = ReturnType<typeof createBrowserRecorder>
