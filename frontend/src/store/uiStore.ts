import { create } from "zustand";
import { persist } from "zustand/middleware";

type LeftTab = "specs" | "files" | "progress";
type Breakpoint = "desktop" | "laptop" | "below-min";

interface UiStore {
  projectPath: string | null;
  projectName: string;
  setProject: (path: string) => void;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  leftDrawerOpen: boolean;
  rightDrawerOpen: boolean;
  leftActiveTab: LeftTab;
  paletteOpen: boolean;
  viewportWidth: number;
  breakpoint: Breakpoint;
  fileTreeVersion: number;

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
      leftPanelCollapsed: false,
      rightPanelCollapsed: false,
      leftDrawerOpen: false,
      rightDrawerOpen: false,
      leftActiveTab: "specs" as LeftTab,
      paletteOpen: false,
      viewportWidth: typeof window !== "undefined" ? window.innerWidth : 1440,
      breakpoint: "desktop" as Breakpoint,
      fileTreeVersion: 0,

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
      }),
    },
  ),
);
