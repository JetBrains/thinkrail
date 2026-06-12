import type { Meta, StoryObj } from "@storybook/react-vite";
import { EditDropdown } from "./EditDropdown";
import "./FileViewer.css";

/**
 * EditDropdown is the file "Edit" menu: edit in place, or open the file in
 * IntelliJ IDEA / VS Code / Vim.
 */
const meta = {
  title: "Files/EditDropdown",
  component: EditDropdown,
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "EditDropdown is the file \"Edit\" menu: edit in place, or open the file in IntelliJ IDEA / VS Code / Vim.\n\n📍 **In the app:** in the file viewer header (open a file from the Files/Specs tree), behind the Edit button." } },
  },
  args: { onEditInPlace: () => {}, onOpenIdea: () => {}, onOpenVscode: () => {}, onOpenVim: () => {}, onClose: () => {} },
  argTypes: {
    onEditInPlace: { table: { disable: true } },
    onOpenIdea: { table: { disable: true } },
    onOpenVscode: { table: { disable: true } },
    onOpenVim: { table: { disable: true } },
    onClose: { table: { disable: true } },
  },
  decorators: [(Story) => <div style={{ position: "relative", height: 200 }}><Story /></div>],
} satisfies Meta<typeof EditDropdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
