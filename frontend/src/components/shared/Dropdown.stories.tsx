import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Dropdown, type DropdownOption } from "./Dropdown";

/**
 * Dropdown is the app's custom <select> replacement (there are no native
 * <select> elements in the codebase). It's a controlled component, supports
 * optional grouping, right-alignment and a disabled state. Real usages:
 * SettingsModal (model/theme pickers), TicketInfo (status/type), DraftConfigCard.
 *
 * These stories wrap it in a small stateful demo since `value`/`onChange` are
 * controlled.
 */
const BASIC: DropdownOption<string>[] = [
  { value: "auto", label: "Auto" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "high-contrast", label: "High Contrast" },
];

const GROUPED: DropdownOption<string>[] = [
  { value: "opus", label: "Claude Opus 4.8", group: "Current" },
  { value: "sonnet", label: "Claude Sonnet 4.6", group: "Current" },
  { value: "haiku", label: "Claude Haiku 4.5", group: "Current" },
  { value: "opus-3", label: "Claude Opus 3", group: "Legacy" },
  { value: "sonnet-35", label: "Claude Sonnet 3.5", group: "Legacy" },
];

const meta = {
  title: "Primitives/Dropdown",
  component: Dropdown,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "The app's custom `<select>` replacement (there are no native `<select>` elements in the codebase): a controlled component with optional grouping, right-alignment and a disabled state.\n\n📍 **In the app:** the model/theme pickers in `SettingsModal`, the status/type pickers in `TicketInfo`, and `DraftConfigCard`.",
      },
    },
  },
  // Stories use a stateful render wrapper; these satisfy Dropdown's required
  // props at the type level but are overridden by each story's `render`.
  args: { value: "dark", options: BASIC, onChange: () => {} },
} satisfies Meta<typeof Dropdown>;

export default meta;
type Story = StoryObj<typeof meta>;

function DropdownDemo({
  options,
  initial,
  disabled,
  align,
}: {
  options: DropdownOption<string>[];
  initial: string;
  disabled?: boolean;
  align?: "left" | "right";
}) {
  const [value, setValue] = useState(initial);
  return (
    <div style={{ maxWidth: 260 }}>
      <Dropdown<string>
        value={value}
        options={options}
        onChange={setValue}
        disabled={disabled}
        align={align}
        ariaLabel="Demo dropdown"
      />
    </div>
  );
}

export const Basic: Story = {
  render: () => <DropdownDemo options={BASIC} initial="dark" />,
};

export const Grouped: Story = {
  render: () => <DropdownDemo options={GROUPED} initial="opus" />,
};

export const Disabled: Story = {
  render: () => <DropdownDemo options={BASIC} initial="dark" disabled />,
};

export const RightAligned: Story = {
  render: () => (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <DropdownDemo options={BASIC} initial="dark" align="right" />
    </div>
  ),
};
