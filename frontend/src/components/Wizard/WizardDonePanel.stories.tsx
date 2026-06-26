import type { Meta, StoryObj } from "@storybook/react-vite";
import { WizardDonePanel } from "./WizardDonePanel";
import type { Session, SessionOutcome } from "@/types/session";
import "./WizardDonePanel.css";

/**
 * WizardDonePanel is the outcome-driven "done" screen a wizard lands on after
 * the skill calls SessionFinalize. Two-column layout: a header (title +
 * saved-doc subtitle), a checkbox-selectable suggested-tickets list, and the
 * next-step CTA cards on the left; the artifact doc preview on the right.
 *
 * Start-session CTAs come from the wizard registry (resolved from the
 * session's skillId), so the stub carries a skillId to surface the hero CTA.
 * Handlers read from the live Zustand stores; this story only exercises the
 * presentational layer, so a minimal session stub is enough.
 */
const session = { thinkrailSid: "story-done", skillId: "new-project" } as Session;

const outcome: SessionOutcome = {
  summary: "Goals and requirements are ready!",
  artifacts: [{ path: "GOAL&REQUIREMENTS.md", openOnDone: true }],
  actions: [
    {
      type: "navigate",
      id: "a2",
      title: "Open board",
      description: "Continue on the board and figure out architecture later.",
      target: "board",
    },
    { type: "create_ticket", id: "t1", title: "Accept city name as CLI argument", body: "Parse argv[1] as the city; error if missing.", state: "pending" },
    { type: "create_ticket", id: "t2", title: "Fetch current weather from a public API", body: "Call the weather API with httpx and handle the response.", state: "pending" },
    { type: "create_ticket", id: "t3", title: "Print one-line summary", body: null, state: "pending" },
    { type: "create_ticket", id: "t4", title: "Handle errors gracefully", body: "Unknown city, network failure — friendly messages, non-zero exit.", state: "applied" },
  ],
};

const meta = {
  title: "Wizard/WizardDonePanel",
  component: WizardDonePanel,
  parameters: {
    layout: "fullscreen",
    docs: { description: { component:
      "WizardDonePanel is the outcome-driven done screen after a wizard finishes: a header with the saved-doc subtitle, a checkbox-selectable suggested-tickets list, next-step CTA cards, and the artifact doc preview alongside.\n\n📍 **In the app:** the final screen of the new-project / wizard flow, rendered by AppShell when a session finalizes." } },
  },
  args: { session, outcome },
  decorators: [(Story) => <div style={{ height: "100vh", display: "flex" }}><Story /></div>],
} satisfies Meta<typeof WizardDonePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
