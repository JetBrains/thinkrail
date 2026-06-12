import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { SpecSelector } from "./SpecSelector";
import { useSpecStore } from "@/store/specStore.ts";
import type { SpecEntry } from "@/types/spec.ts";

/**
 * SpecSelector picks one or more specs, shown as removable chips with an
 * "+ Add spec" dropdown. It reads the spec list from the spec store, so the
 * story seeds it with a few mock specs.
 */
const MOCK_SPECS: SpecEntry[] = [
  { id: "agent-runner", type: "module", path: "agent/README.md", title: "Agent Runner", status: "active", covers: [], tags: [], created: "", updated: "" },
  { id: "spec-index", type: "module", path: "spec/README.md", title: "Spec Index", status: "active", covers: [], tags: [], created: "", updated: "" },
  { id: "board-service", type: "module", path: "board/README.md", title: "Board Service", status: "draft", covers: [], tags: [], created: "", updated: "" },
  { id: "ws-rpc", type: "submodule", path: "rpc/README.md", title: "WebSocket RPC", status: "active", covers: [], tags: [], created: "", updated: "" },
  { id: "trash-soft-delete", type: "task", path: "trash/spec.md", title: "Trash / Soft Delete", status: "active", covers: [], tags: [], created: "", updated: "" },
];

const meta = {
  title: "Pickers/SpecSelector",
  component: SpecSelector,
  beforeEach: () => {
    useSpecStore.setState({ specs: MOCK_SPECS });
  },
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "SpecSelector picks one or more specs, shown as removable chips with an \"+ Add spec\" dropdown, reading the spec list from the spec store.\n\n📍 **In the app:** in the draft session config card's Specs \"+ add spec\" popover (`DraftConfigCard`)." } },
  },
  args: { selectedIds: [], onToggle: () => {} },
} satisfies Meta<typeof SpecSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

function SpecSelectorDemo({ initial, ...props }: { initial: string[]; initiallyOpen?: boolean; inline?: boolean }) {
  const [selectedIds, setSelectedIds] = useState<string[]>(initial);
  const toggle = (id: string) =>
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  return <SpecSelector selectedIds={selectedIds} onToggle={toggle} {...props} />;
}

export const WithSelection: Story = {
  render: () => <SpecSelectorDemo initial={["agent-runner", "ws-rpc"]} />,
};

export const Open: Story = {
  render: () => <SpecSelectorDemo initial={["agent-runner"]} initiallyOpen />,
};

export const Inline: Story = {
  render: () => <SpecSelectorDemo initial={["spec-index"]} inline initiallyOpen />,
};
