import type { Meta, StoryObj } from "@storybook/react-vite"
import { BugReportDialog } from "./bug-report-dialog.js"

const meta = {
  title: "Composites/BugReportDialog",
  component: BugReportDialog,
  parameters: { layout: "centered" },
  args: {
    open: true,
    onOpenChange: () => {},
    chats: [{ id: "c1", sessionId: "s1", label: "Fix login · Untitled chat" }],
    onSubmit: async () => ({ url: "https://github.com/acme/jingler/issues/1" })
  }
} satisfies Meta<typeof BugReportDialog>

export default meta
export const Default: StoryObj<typeof meta> = {}
