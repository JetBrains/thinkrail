import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/AppShell/AppShell.tsx";

export function AppRoutes({ onSwitchProject }: { onSwitchProject: () => void }) {
  return (
    <Routes>
      <Route path="/" element={<AppShell onSwitchProject={onSwitchProject} />}>
        <Route index element={<Navigate to="/workspace" replace />} />
        <Route path="workspace">
          <Route index element={null} />
          <Route path="spec/:specId" element={null} />
          <Route path="session/:bonsaiSid" element={null} />
          <Route path="graph" element={null} />
        </Route>
      </Route>
    </Routes>
  );
}
