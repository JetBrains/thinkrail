import type { Meta, StoryObj } from "@storybook/react-vite";
import { CoveredFiles } from "./CoveredFiles";
import { seedSpecContext } from "./_seed";

/**
 * CoveredFiles lists the file/dir patterns the selected spec covers, with
 * file vs. directory icons. (Seeded spec covers an agent dir + a file.)
 */
const meta = {
  title: "Context Panel/CoveredFiles",
  component: CoveredFiles,
  beforeEach: () => { seedSpecContext(); },
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "CoveredFiles lists the file/dir patterns the selected spec covers, with file vs. directory icons.\n\n📍 **In the app:** in the right-hand Agent Context panel (toggle Ctrl+J) when a spec is selected." } },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 320, background: "var(--panel)", padding: "var(--space-sm)", borderRadius: "var(--radius-md)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CoveredFiles>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
