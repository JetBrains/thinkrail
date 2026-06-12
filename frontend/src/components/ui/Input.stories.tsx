import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "./Input";

const meta: Meta<typeof Input> = {
  title: "Primitives/Input",
  component: Input,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Text input component with design token styling.\n\n" +
          "Features:\n" +
          "- Uses `--input-bg` token for background color\n" +
          "- Uses `--white-20` for focus border\n" +
          "- Error state support\n" +
          "- Disabled state support\n" +
          "- Consistent with form styling across the app",
      },
    },
  },
  argTypes: {
    error: {
      control: "boolean",
      description: "Applies error styling (red border)",
    },
    placeholder: {
      control: "text",
      description: "Placeholder text",
    },
    disabled: {
      control: "boolean",
      description: "Disabled state",
    },
    defaultValue: {
      control: "text",
      description: "Initial value",
    },
  },
  decorators: [(Story) => <div style={{ width: 400 }}><Story /></div>],
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: {
    placeholder: "e.g. inventory service",
  },
};

export const WithValue: Story = {
  args: {
    placeholder: "e.g. inventory service",
    defaultValue: "my-project",
  },
};

export const Focused: Story = {
  args: {
    placeholder: "e.g. inventory service",
    autoFocus: true,
  },
  parameters: {
    docs: {
      description: {
        story: "Focus state shows a white border (--white-20) via box-shadow.",
      },
    },
  },
};

export const Error: Story = {
  args: {
    placeholder: "e.g. inventory service",
    error: true,
  },
  parameters: {
    docs: {
      description: {
        story: "Error state applies red border color.",
      },
    },
  },
};

export const ErrorWithValue: Story = {
  args: {
    placeholder: "e.g. inventory service",
    defaultValue: "invalid@@@name",
    error: true,
  },
};

export const Disabled: Story = {
  args: {
    placeholder: "e.g. inventory service",
    disabled: true,
  },
};

export const DisabledWithValue: Story = {
  args: {
    placeholder: "e.g. inventory service",
    defaultValue: "read-only-project",
    disabled: true,
  },
};

export const LongPlaceholder: Story = {
  args: {
    placeholder: "Enter your project name (e.g. inventory-management-service)",
  },
};

export const MaxLength: Story = {
  args: {
    placeholder: "Limited to 20 characters",
    maxLength: 20,
  },
  parameters: {
    docs: {
      description: {
        story: "Demonstrates maxLength constraint - try typing more than 20 characters.",
      },
    },
  },
};
