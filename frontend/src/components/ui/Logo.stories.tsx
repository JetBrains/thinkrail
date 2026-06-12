import type { Meta, StoryObj } from "@storybook/react-vite";
import { Logo } from "./Logo";
import { PRODUCT_NAME } from "@/constants/branding";
// header-logo / picker-h1-logo sizing classes live in these stylesheets.
import "../AppShell/AppShell.css";
import "../ProjectPicker/ProjectPicker.css";

/**
 * Logo is the product wordmark (SVG). It's used in the app header and across the
 * project-picker / onboarding screens. Sizing comes from the applied class
 * (header-logo by default; picker-h1-logo for the large welcome heading).
 */
const meta = {
  title: "Primitives/Logo",
  component: Logo,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          `The ${PRODUCT_NAME} wordmark (SVG). Sizing comes from the applied class (\`header-logo\` by default; \`picker-h1-logo\` for the large welcome heading).\n\n📍 **In the app:** the top-left of the app \`Header\`, and the large welcome heading on the \`ProjectPicker\` / onboarding screens.`,
      },
    },
  },
} satisfies Meta<typeof Logo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Header: Story = {};
export const PickerHeading: Story = { args: { className: "picker-h1-logo" } };
