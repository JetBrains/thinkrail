import { Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/AppShell/AppShell.tsx";
import type { NewProjectData } from "@/components/ProjectPicker/ProjectPicker.tsx";

export function AppRoutes({ onSwitchProject, newProjectData }: { onSwitchProject: (projectPath?: string) => void; newProjectData?: NewProjectData }) {
  return (
    <Routes>
      <Route
        path="/:projectSlug/workspace"
        element={<AppShell onSwitchProject={onSwitchProject} newProjectData={newProjectData} />}
      >
        <Route index element={null} />
        <Route path="spec/:specId" element={null} />
        <Route path="session/:thinkrailSid" element={null} />
        <Route path="graph" element={null} />
      </Route>
    </Routes>
  );
}
