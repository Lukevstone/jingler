import type { Meta, StoryObj } from "@storybook/react-vite"
import { CircleDot } from "lucide-react"
import { fn } from "storybook/test"
import { SessionHeaderIdentity } from "./session-header-identity.js"

const meta = {
  title: "App/SessionHeaderIdentity",
  component: SessionHeaderIdentity,
  parameters: { layout: "centered" }
} satisfies Meta<typeof SessionHeaderIdentity>

export default meta
type Story = StoryObj<typeof meta>

/** Outlined issue chip; the title and branch live in the sidebar and chat tab. */
export const Default: Story = {
  args: {
    chips: [{ id: "issue", label: "LIN-482", title: "Open LIN-482", icon: CircleDot, onOpen: fn() }]
  }
}

/** No linked issue renders nothing. */
export const Empty: Story = { args: { chips: [] } }
