import { createContext, useContext, type ReactNode } from "react";
import { useSettingsStore } from "@/store/settingsStore.ts";

export type ViewMode = "classic" | "compact";

const ViewModeContext = createContext<ViewMode>("classic");

export function useViewMode(): ViewMode {
  return useContext(ViewModeContext);
}

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const eventView = useSettingsStore((s) => s.settings?.event_view);
  const mode: ViewMode =
    eventView === "compact" ? "compact" : "classic";

  return (
    <ViewModeContext value={mode}>
      {children}
    </ViewModeContext>
  );
}
