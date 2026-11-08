const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/gu
const WHITESPACE = /\s+/u
const OMITTED_TEXT = "button, [aria-hidden=true], script, style, svg"
const TEXT_BLOCK = "p, li, pre, td, th, blockquote, h1, h2, h3, h4, h5, h6"

interface TextSegment { readonly node: Text; readonly start: number; readonly end: number }

/** Read prose and code, excluding author labels and Markdown's action buttons. */
function renderedText(root: HTMLElement) {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  const segments: TextSegment[] = []
  let text = ""
  let previousBlock: Element | null = null
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType !== Node.TEXT_NODE) {
      if ((node as Element).matches(".sb-md br")) text += " "
      continue
    }
    const parent = node.parentElement
    const surface = parent?.closest(".sb-md")
    if (!surface || parent?.closest(OMITTED_TEXT)) continue
    const block = parent?.closest(TEXT_BLOCK) ?? surface
    if (previousBlock && previousBlock !== block) text += " "
    previousBlock = block
    const start = text.length
    const textNode = node as Text
    text += textNode.data
    segments.push({ node: textNode, start, end: text.length })
  }
  return { text, segments }
}

/** A native Range preserves inline formatting, selection, and the rendered DOM. */
export function conversationSearchRange(root: HTMLElement, query: string): Range | null {
  const needle = query.trim()
  if (!needle) return null
  const pattern = needle.split(WHITESPACE).map((word) => word.replace(REGEX_SPECIAL, "\\$&")).join("\\s+")
  const { text, segments } = renderedText(root)
  const match = new RegExp(pattern, "iu").exec(text)
  if (!match) return null
  const end = match.index + match[0].length
  const first = segments.find((segment) => segment.start <= match.index && segment.end > match.index)
  const last = segments.find((segment) => segment.start < end && segment.end >= end)
  if (!first || !last) return null
  const range = root.ownerDocument.createRange()
  range.setStart(first.node, match.index - first.start)
  range.setEnd(last.node, end - last.start)
  return range
}
