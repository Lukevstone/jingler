import type { Meta, StoryObj } from "@storybook/react-vite"
import { SideChatPanel } from "./side-chat-panel.js"

const meta: Meta<typeof SideChatPanel> = {
  title: "Composites/SideChatPanel",
  component: SideChatPanel,
  args: { messages: [], busy: false, onAsk: () => undefined, onClose: () => undefined, onToggleExpand: () => undefined },
  decorators: [(Story) => <div style={{ height: 560, width: 380 }}><Story /></div>]
}
export default meta
type Story = StoryObj<typeof SideChatPanel>

export const Empty: Story = {}

export const Answered: Story = {
  args: {
    messages: [
      { id: "u1", role: "user", text: "Which files did we touch so far?" },
      { id: "a1", role: "assistant", text: "Three so far:\n\n- `claude-agent-runtime.ts`\n- `codex/runtime.ts`\n- `pi-agent-runtime.ts`" }
    ]
  }
}

export const Streaming: Story = {
  args: {
    busy: true,
    messages: [
      { id: "u1", role: "user", text: "Why fork instead of resume?" },
      { id: "a1", role: "assistant", text: "Forking keeps the main transcript unchanged, so", streaming: true }
    ]
  }
}

export const Failed: Story = {
  args: {
    messages: [{ id: "u1", role: "user", text: "Are we on JWT?" }],
    error: "Side chat isn't available on remote sessions yet."
  }
}
