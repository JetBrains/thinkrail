import type { Meta, StoryObj } from "@storybook/react";
import { Select } from "./Select";
import { useState } from "react";

const meta: Meta<typeof Select> = {
  title: "UI/Select",
  component: Select,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    disabled: {
      control: "boolean",
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const options = [
  { label: "Feature", value: "feature" },
  { label: "Bug", value: "bug" },
  { label: "Idea", value: "idea" },
  { label: "Improvement", value: "improvement" },
];

function SelectWrapper() {
  const [value, setValue] = useState("feature");
  return (
    <div style={{ width: 300 }}>
      <Select value={value} options={options} onChange={setValue} />
    </div>
  );
}

export const Default: Story = {
  render: () => <SelectWrapper />,
};

function SelectWithPlaceholder() {
  const [value, setValue] = useState("");
  return (
    <div style={{ width: 300 }}>
      <Select
        value={value}
        options={options}
        onChange={setValue}
        placeholder="Choose an option..."
      />
    </div>
  );
}

export const WithPlaceholder: Story = {
  render: () => <SelectWithPlaceholder />,
};

export const Disabled: Story = {
  render: () => (
    <div style={{ width: 300 }}>
      <Select
        value="feature"
        options={options}
        onChange={() => {}}
        disabled
      />
    </div>
  ),
};
