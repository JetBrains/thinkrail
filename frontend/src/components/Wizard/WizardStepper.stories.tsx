import type { Meta, StoryObj } from "@storybook/react-vite";
import { WizardStepper } from "./WizardStepper";
import type { WizardStep } from "./registry";

/**
 * WizardStepper renders a horizontal step indicator from a list of steps, each
 * with a status (pending / active / done). Each step has an icon; done steps show
 * a green icon, the active step is highlighted with a purple icon.
 */
const NEW_PROJECT_STEPS: WizardStep[] = [
  { label: "Describe project", status: "done", icon: "grid-2x2-plus" },
  { label: "Define goals", status: "done", icon: "target" },
  { label: "Goals ready", status: "done", icon: "book-check" },
  { label: "Define architecture", status: "active", icon: "pencil-ruler" },
  { label: "Architecture ready", status: "pending", icon: "pencil-ruler" },
];

const INVESTIGATE_PROJECT_STEPS: WizardStep[] = [
  { label: "Select files", status: "done", icon: "file-text" },
  { label: "Investigation", status: "done", icon: "brain" },
  { label: "Review", status: "done", icon: "eye" },
  { label: "Clarify", status: "done", icon: "diamond-plus" },
  { label: "Verify & save", status: "active", icon: "badge-check" },
  { label: "Define architecture", status: "pending", icon: "pencil-ruler" },
  { label: "Architecture ready", status: "pending", icon: "pencil-ruler" },
];

const meta = {
  title: "Wizard/WizardStepper",
  component: WizardStepper,
  parameters: {
    layout: "padded",
    docs: { description: { component:
      "WizardStepper renders a horizontal step indicator from a list of steps, each with a status (pending / active / done) and an icon. Icons are from lucide-react. The active step is highlighted with a purple background; done steps show a green background.\n\n📍 **In the app:** the horizontal step indicator across the top of the new-project and investigate-project wizard flows." } },
  },
  args: { steps: NEW_PROJECT_STEPS },
} satisfies Meta<typeof WizardStepper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewProjectInProgress: Story = {
  name: "New Project - In Progress",
};

export const NewProjectFirstStep: Story = {
  name: "New Project - First Step",
  args: {
    steps: NEW_PROJECT_STEPS.map((s, i) => ({
      ...s,
      status: i === 0 ? "active" : "pending" as const,
    })),
  },
};

export const NewProjectComplete: Story = {
  name: "New Project - Complete",
  args: { steps: NEW_PROJECT_STEPS.map((s) => ({ ...s, status: "done" as const })) },
};

export const InvestigateProjectInProgress: Story = {
  name: "Investigate Project - In Progress",
  args: { steps: INVESTIGATE_PROJECT_STEPS },
};

export const InvestigateProjectFirstStep: Story = {
  name: "Investigate Project - First Step",
  args: {
    steps: INVESTIGATE_PROJECT_STEPS.map((s, i) => ({
      ...s,
      status: i === 0 ? "active" : "pending" as const,
    })),
  },
};

export const InvestigateProjectComplete: Story = {
  name: "Investigate Project - Complete",
  args: { steps: INVESTIGATE_PROJECT_STEPS.map((s) => ({ ...s, status: "done" as const })) },
};
