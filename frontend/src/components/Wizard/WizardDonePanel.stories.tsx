import type { Meta, StoryObj } from "@storybook/react-vite";
import { WizardDonePanel } from "./WizardDonePanel";
import type { Session, SessionOutcome } from "@/types/session";
import "./WizardDonePanel.css";

/**
 * WizardDonePanel is the outcome-driven "done" screen a wizard lands on after
 * the skill calls SessionFinalize: a success banner, next-step CTA cards
 * (hero start-session + secondary start/navigate actions), and a suggested-
 * tickets queue with per-item and "Add all" actions. The optional artifact
 * doc renders to its right (omitted here — see MarkdownPreview for that).
 *
 * Handlers read from the live Zustand stores; this story only exercises the
 * presentational layer, so a minimal session stub is enough.
 */
const session = { thinkrailSid: "story-done" } as Session;

const outcome: SessionOutcome = {
  summary: "Project planted. Doc saved to GOAL&REQUIREMENTS.md.",
  artifacts: [],
  actions: [
    {
      type: "start_session",
      id: "a1",
      title: "Continue → Architecture",
      description: "Sketch the stack & modules in a DESIGN_DOC.md before tickets start running.",
      skillId: "architecture-design",
      primary: true,
    },
    {
      type: "navigate",
      id: "a2",
      title: "Skip → Open workspace",
      description: "Architecture can wait. Land on the board now.",
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
      "WizardDonePanel is the outcome-driven done screen after a wizard finishes: a success banner, next-step CTA cards, and a suggested-tickets queue.\n\n📍 **In the app:** the final screen of the new-project / wizard flow, rendered by AppShell when a session finalizes." } },
  },
  args: { session, outcome },
  decorators: [(Story) => <div style={{ height: "100vh", display: "flex" }}><Story /></div>],
} satisfies Meta<typeof WizardDonePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
