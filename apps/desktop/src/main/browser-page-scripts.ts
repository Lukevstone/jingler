/**
 * Source strings `executeJavaScript` runs inside the agent-driven browser page.
 * Kept as strings, not serialised functions: the main bundle's minifier would
 * rename or wrap a function and break `fn.toString()`.
 */

const OVERLAY_ATTR = "data-jingler-overlay"

/**
 * The agent cursor's colour. A literal on purpose: it paints inside a foreign
 * page, which has none of the app's `--sb-*` tokens.
 */
const CURSOR_COLOR = "#7c5cff"

export type PointerKind = "click" | "type" | "hover" | "focus"

/**
 * Scroll the target into view, glide the agent cursor to its centre, ring the
 * element, and (for a click) ripple. Resolves `{x, y}` in CSS viewport pixels
 * once the cursor has arrived, or `null` when nothing matches. Every overlay
 * node is `pointer-events:none` so it never intercepts the real action.
 */
export const pointAtScript = (selector: string, kind: PointerKind): string => `new Promise((resolve) => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return resolve(null);
  const kind = ${JSON.stringify(kind)};
  el.scrollIntoView({ block: "center", inline: "center" });
  const r = el.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
  const mk = (css) => {
    const d = document.createElement("div");
    d.setAttribute("${OVERLAY_ATTR}", "");
    d.setAttribute("aria-hidden", "true");
    d.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;" + css;
    document.documentElement.appendChild(d);
    return d;
  };
  let c = document.getElementById("__jingler_cursor");
  if (!c) {
    c = mk("left:0;top:0;margin:-2px 0 0 -3px;transition:transform 300ms cubic-bezier(.2,.8,.2,1),opacity 200ms;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));");
    c.id = "__jingler_cursor";
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="${CURSOR_COLOR}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    c.style.transform = "translate(" + Math.round(innerWidth / 2) + "px," + Math.round(innerHeight / 2) + "px)";
    c.getBoundingClientRect();
  }
  c.style.opacity = "1";
  c.style.transform = "translate(" + x + "px," + y + "px)";
  const ring = mk("left:" + (r.left - 3) + "px;top:" + (r.top - 3) + "px;width:" + (r.width + 6) + "px;height:" + (r.height + 6) + "px;border:2px solid ${CURSOR_COLOR};border-radius:6px;transition:opacity 600ms;");
  setTimeout(() => { ring.style.opacity = "0"; }, 900);
  setTimeout(() => ring.remove(), 1600);
  clearTimeout(window.__jinglerCursorFade);
  window.__jinglerCursorFade = setTimeout(() => { c.style.opacity = "0"; }, 3000);
  setTimeout(() => {
    if (kind === "click") {
      const p = mk("left:" + (x - 18) + "px;top:" + (y - 18) + "px;width:36px;height:36px;border-radius:50%;background:${CURSOR_COLOR};opacity:.45;transform:scale(.2);transition:transform 450ms ease-out,opacity 450ms ease-out;");
      p.getBoundingClientRect();
      p.style.transform = "scale(1)";
      p.style.opacity = "0";
      setTimeout(() => p.remove(), 500);
    }
    resolve({ x, y });
  }, 320);
})`

/** Drop every overlay node so a screenshot shows the page, not our cursor. */
export const hideOverlayScript = `new Promise((resolve) => {
  document.querySelectorAll("[${OVERLAY_ATTR}]").forEach((n) => n.remove());
  setTimeout(resolve, 50);
})`

/** The element's rect clipped to the viewport, scrolled into view first; `null` if absent or empty. */
export const elementRectScript = (selector: string): string => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  el.scrollIntoView({ block: "center", inline: "center" });
  const r = el.getBoundingClientRect();
  const x = Math.max(0, Math.floor(r.left)), y = Math.max(0, Math.floor(r.top));
  const width = Math.min(innerWidth, Math.ceil(r.right)) - x, height = Math.min(innerHeight, Math.ceil(r.bottom)) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
})()`

export const focusScript = (selector: string): string => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  el.focus();
  return true;
})()`

/** Pick an option by value, then by visible label, through the native setter so React notices. */
export const selectOptionScript = (selector: string, value: string): string => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return "missing";
  if (!(el instanceof HTMLSelectElement)) return "not-select";
  const want = ${JSON.stringify(value)};
  const opt = [...el.options].find((o) => o.value === want) || [...el.options].find((o) => o.text.trim() === want);
  if (!opt) return "no-option";
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, opt.value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return "ok";
})()`

export const scrollByScript = (deltaY: number): string => `window.scrollBy(0, ${Number(deltaY) || 0})`

/**
 * Visible interactive elements with the shortest unique selector we can find:
 * id, data-testid, name, aria-label, placeholder, then an nth-of-type path.
 */
export const snapshotScript = String.raw`(() => {
  const SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=textbox],[contenteditable=""],[contenteditable=true]';
  const unique = (s) => { try { return document.querySelectorAll(s).length === 1; } catch { return false; } };
  const byId = (el) => el.id && unique("#" + CSS.escape(el.id)) ? "#" + CSS.escape(el.id) : null;
  const byAttr = (el, name) => {
    const v = el.getAttribute(name);
    if (!v) return null;
    const s = el.tagName.toLowerCase() + "[" + name + "=" + JSON.stringify(v) + "]";
    return unique(s) ? s : null;
  };
  const path = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      const id = byId(n);
      if (id) { parts.unshift(id); break; }
      let i = 1;
      for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i++;
      parts.unshift(n.tagName.toLowerCase() + ":nth-of-type(" + i + ")");
    }
    return parts.join(" > ");
  };
  const out = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (el.closest("[data-jingler-overlay]")) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none") continue;
    const label = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || el.value || el.getAttribute("title") || el.getAttribute("alt") || "").trim().replace(/\s+/g, " ").slice(0, 80);
    out.push({
      selector: byId(el) || byAttr(el, "data-testid") || byAttr(el, "name") || byAttr(el, "aria-label") || byAttr(el, "placeholder") || path(el),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      label,
      disabled: !!el.disabled || el.getAttribute("aria-disabled") === "true"
    });
    if (out.length >= 200) break;
  }
  return out;
})()`

const NAMED_KEYS: Readonly<Record<string, readonly [code: string, keyCode: number, text?: string]>> = {
  Enter: ["Enter", 13, "\r"],
  Tab: ["Tab", 9],
  Escape: ["Escape", 27],
  Backspace: ["Backspace", 8],
  Delete: ["Delete", 46],
  ArrowUp: ["ArrowUp", 38],
  ArrowDown: ["ArrowDown", 40],
  ArrowLeft: ["ArrowLeft", 37],
  ArrowRight: ["ArrowRight", 39],
  Home: ["Home", 36],
  End: ["End", 35],
  PageUp: ["PageUp", 33],
  PageDown: ["PageDown", 34],
  Space: ["Space", 32, " "]
}

export interface CdpKeyEvent {
  readonly type: "keyDown" | "rawKeyDown" | "keyUp"
  readonly key: string
  readonly code: string
  readonly windowsVirtualKeyCode: number
  readonly text?: string
}

/**
 * `Input.dispatchKeyEvent` params for one key press. A key that produces text
 * goes down as `keyDown` (so Chromium fires keypress/input and Enter submits);
 * the rest go down as `rawKeyDown`, as Puppeteer does.
 */
export const cdpKeyEvents = (key: string): ReadonlyArray<CdpKeyEvent> => {
  const named = NAMED_KEYS[key === " " ? "Space" : key]
  if (named === undefined && [...key].length !== 1) {
    throw new Error(`Unsupported key "${key}". Use one character or one of: ${Object.keys(NAMED_KEYS).join(", ")}`)
  }
  const upper = key.toUpperCase()
  const [code, keyCode, text] = named ?? [
    /^[A-Z]$/u.test(upper) ? `Key${upper}` : /^\d$/u.test(key) ? `Digit${key}` : "",
    upper.charCodeAt(0),
    key
  ]
  const base = { key: code === "Space" ? " " : named ? code : key, code, windowsVirtualKeyCode: keyCode }
  return [
    text === undefined ? { type: "rawKeyDown", ...base } : { type: "keyDown", ...base, text },
    { type: "keyUp", ...base }
  ]
}
