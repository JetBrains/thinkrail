import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EventCategory } from "@/components/ChatStream/renderers/categories.ts";
import type { JourneyEntry } from "@/components/Wizard/registry.ts";

export const LEFT_TABS = ["specs", "files", "sessions"] as const;
export type LeftTab = (typeof LEFT_TABS)[number];
type Breakpoint = "desktop" | "laptop" | "below-min";
export type ProjectState = "initialized" | "new" | "existing";
export type CenterView = "board" | "sessions";

export type ChatCategoryVisibility = Record<EventCategory, boolean>;

/**
 * Resolve what to do with sessions for a given project state.
 * Returns `null` when the welcome screen handles the workspace (state="new").
 *
 * Exhaustive switch — TypeScript will flag the call site if a new
 * ProjectState value is added without updating this strategy.
 */
export function sessionLoadStrategy(
  state: ProjectState,
): { includeRecentDiskSession: boolean } | null {
  switch (state) {
    case "new":
      return null;
    case "initialized":
      return { includeRecentDiskSession: true };
    case "existing":
      return { includeRecentDiskSession: false };
  }
}

interface UiStore {
  projectPath: string | null;
  projectName: string;
  setProject: (path: string) => void;
  projectState: ProjectState | null;
  setProjectState: (state: ProjectState | null) => void;
  /** Active wizard chain ID — disambiguates which set of stepper
   *  labels to show when a wizard skill participates in more than one
   *  chain (e.g. ``new-project`` runs as the standalone greenfield
   *  flow under chain "new-project", or as the Clarify session under
   *  chain "investigate-project"). Set by the entry-point screen,
   *  cleared when the user returns to the picker. */
  currentChain: string | null;
  setCurrentChain: (chain: string | null) => void;
  /** Ordered list of wizard sessions the user has actually launched —
   *  the source for the cumulative top stepper (see `stepperFromJourney`).
   *  Appended on every entry/follow-up session start, cleared when the
   *  user returns to the picker. Persisted so a reload keeps the journey. */
  wizardJourney: JourneyEntry[];
  appendWizardStep: (entry: JourneyEntry) => void;
  clearWizardJourney: () => void;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  leftDrawerOpen: boolean;
  rightDrawerOpen: boolean;
  leftActiveTab: LeftTab;
  paletteOpen: boolean;
  viewportWidth: number;
  breakpoint: Breakpoint;
  fileTreeVersion: number;

  chatCategoryVisibility: ChatCategoryVisibility;
  toggleChatCategory: (category: EventCategory) => void;

  centerView: CenterView;
  setCenterView: (view: CenterView) => void;
  /** Switch center view to Sessions and focus the sidebar Sessions tab in
   *  one action. Use from surfaces that mean "show me the Sessions UI",
   *  not from incidental flows like `createNewSession` that just need
   *  the center view to be Sessions. */
  focusSessions: () => void;

  /** Per-project last-active session ID. Persisted so a page reload
   *  picks up where the user left off instead of auto-selecting an
   *  unrelated session by mtime. */
  lastActiveSessions: Record<string, string>;
  rememberActiveSession: (projectPath: string, bonsaiSid: string | null) => void;

  /** bonsaiSids whose wizard done-screen the user has explicitly
   *  dismissed (e.g. clicked "Open workspace"). Persisted so reactivating
   *  the session doesn't drag the user back into the done-screen — they
   *  said they're done with the flow globally. */
  dismissedWizardOutcomes: string[];
  dismissWizardOutcome: (bonsaiSid: string) => void;

  /** When set, the right preview panel renders a ReviewPanel for the given
   *  file, sourcing pending+resolved ProposeChange requests from the session. */
  activeReview: { sid: string; filePath: string } | null;
  setActiveReview: (review: { sid: string; filePath: string } | null) => void;

  /** When true, the ticket view's right-panel artifact bar shows a single-line
   *  collapsed header. When false, full tabs. Persisted across sessions. */
  ticketArtifactBarCollapsed: boolean;
  setTicketArtifactBarCollapsed: (collapsed: boolean) => void;

  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setLeftTab: (tab: LeftTab) => void;
  togglePalette: () => void;
  updateViewport: (width: number) => void;
  onFileTreeChanged: () => void;
}

function computeBreakpoint(width: number): Breakpoint {
  if (width >= 1280) return "desktop";
  if (width >= 1024) return "laptop";
  return "below-min";
}

export const useUiStore = create<UiStore>()(
  persist(
    (set) => ({
      projectPath: null,
      projectName: "Project",
      setProject: (path: string) =>
        set({ projectPath: path, projectName: path.split("/").pop() ?? "Project" }),
      projectState: null,
      setProjectState: (state) => set({ projectState: state }),
      currentChain: null,
      setCurrentChain: (chain) => set({ currentChain: chain }),
      wizardJourney: [] as JourneyEntry[],
      appendWizardStep: (entry) =>
        set((s) =>
          // Idempotent: re-rendering or re-selecting a session must not
          // duplicate or reorder its cells.
          s.wizardJourney.some((e) => e.bonsaiSid === entry.bonsaiSid)
            ? s
            : { wizardJourney: [...s.wizardJourney, entry] },
        ),
      clearWizardJourney: () => set({ wizardJourney: [] }),
      leftPanelCollapsed: false,
      rightPanelCollapsed: false,
      leftDrawerOpen: false,
      rightDrawerOpen: false,
      leftActiveTab: "specs" as LeftTab,
      paletteOpen: false,
      viewportWidth: typeof window !== "undefined" ? window.innerWidth : 1440,
      breakpoint: "desktop" as Breakpoint,
      fileTreeVersion: 0,

      chatCategoryVisibility: { dialog: true, tools: true, system: true },
      toggleChatCategory: (category) =>
        set((s) => ({
          chatCategoryVisibility: {
            ...s.chatCategoryVisibility,
            [category]: !s.chatCategoryVisibility[category],
          },
        })),

      centerView: "sessions" as CenterView,
      setCenterView: (view) => set({ centerView: view }),
      focusSessions: () =>
        set({ centerView: "sessions", leftActiveTab: "sessions" }),

      lastActiveSessions: {} as Record<string, string>,
      rememberActiveSession: (projectPath, bonsaiSid) =>
        set((s) => {
          if (!projectPath) return s;
          const next = { ...s.lastActiveSessions };
          if (bonsaiSid) next[projectPath] = bonsaiSid;
          else delete next[projectPath];
          return { lastActiveSessions: next };
        }),

      dismissedWizardOutcomes: [] as string[],
      dismissWizardOutcome: (bonsaiSid) =>
        set((s) =>
          s.dismissedWizardOutcomes.includes(bonsaiSid)
            ? s
            : { dismissedWizardOutcomes: [...s.dismissedWizardOutcomes, bonsaiSid] },
        ),

      activeReview: null,
      setActiveReview: (review) => set({ activeReview: review }),

      ticketArtifactBarCollapsed: false,
      setTicketArtifactBarCollapsed: (collapsed) => set({ ticketArtifactBarCollapsed: collapsed }),

      toggleLeftPanel: () =>
        set((s) => ({ leftPanelCollapsed: !s.leftPanelCollapsed })),
      toggleRightPanel: () =>
        set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
      setLeftTab: (tab) => set({ leftActiveTab: tab }),
      togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
      updateViewport: (width) =>
        set({ viewportWidth: width, breakpoint: computeBreakpoint(width) }),
      onFileTreeChanged: () =>
        set((s) => ({ fileTreeVersion: s.fileTreeVersion + 1 })),
    }),
    {
      name: "bonsai-ui",
      partialize: (state) => ({
        leftPanelCollapsed: state.leftPanelCollapsed,
        rightPanelCollapsed: state.rightPanelCollapsed,
        leftActiveTab: state.leftActiveTab,
        chatCategoryVisibility: state.chatCategoryVisibility,
        centerView: state.centerView,
        lastActiveSessions: state.lastActiveSessions,
        dismissedWizardOutcomes: state.dismissedWizardOutcomes,
        ticketArtifactBarCollapsed: state.ticketArtifactBarCollapsed,
        // Persist the active chain hint so a reload / reopening a project
        // mid-flow keeps the stepper on the right chain. Without this,
        // `currentChain` resets to null on reload and a `new-project`
        // session (which lives in BOTH the new-project and investigate
        // chains) resolves to the greenfield labels, overwriting the
        // investigate steps. Cleared on project switch (Root.handleSelect).
        currentChain: state.currentChain,
        // Persist the cumulative stepper journey for the same reason.
        wizardJourney: state.wizardJourney,
      }),
    },
  ),
);
