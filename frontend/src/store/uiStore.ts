import { create } from "zustand";
import { persist } from "zustand/middleware";

type LeftTab = "specs" | "reqs" | "files" | "progress";
type RightTab = "graph" | "spec" | "code" | "diff" | "console";
type Breakpoint = "desktop" | "laptop" | "below-min";

interface ModalPrefill {
  skillId?: string;
  specIds?: string[];
  name?: string;
}

interface UiStore {
  projectPath: string | null;
  projectName: string;
  setProject: (path: string) => void;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  leftDrawerOpen: boolean;
  rightDrawerOpen: boolean;
  leftActiveTab: LeftTab;
  rightActiveTab: RightTab;
  modalOpen: boolean;
  modalPrefill: ModalPrefill | null;
  paletteOpen: boolean;
  viewportWidth: number;
  breakpoint: Breakpoint;

  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setLeftTab: (tab: LeftTab) => void;
  setRightTab: (tab: RightTab) => void;
  openModal: (prefill?: ModalPrefill) => void;
  closeModal: () => void;
  togglePalette: () => void;
  updateViewport: (width: number) => void;
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
      leftPanelCollapsed: false,
      rightPanelCollapsed: false,
      leftDrawerOpen: false,
      rightDrawerOpen: false,
      leftActiveTab: "specs" as LeftTab,
      rightActiveTab: "graph" as RightTab,
      modalOpen: false,
      modalPrefill: null,
      paletteOpen: false,
      viewportWidth: typeof window !== "undefined" ? window.innerWidth : 1440,
      breakpoint: "desktop" as Breakpoint,

      toggleLeftPanel: () =>
        set((s) => ({ leftPanelCollapsed: !s.leftPanelCollapsed })),
      toggleRightPanel: () =>
        set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
      setLeftTab: (tab) => set({ leftActiveTab: tab }),
      setRightTab: (tab) => set({ rightActiveTab: tab }),
      openModal: (prefill) =>
        set({ modalOpen: true, modalPrefill: prefill ?? null }),
      closeModal: () => set({ modalOpen: false, modalPrefill: null }),
      togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
      updateViewport: (width) =>
        set({ viewportWidth: width, breakpoint: computeBreakpoint(width) }),
    }),
    {
      name: "bonsai-ui",
      partialize: (state) => ({
        leftPanelCollapsed: state.leftPanelCollapsed,
        rightPanelCollapsed: state.rightPanelCollapsed,
        leftActiveTab: state.leftActiveTab,
        rightActiveTab: state.rightActiveTab,
      }),
    },
  ),
);
