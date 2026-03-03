import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/AppShell/AppShell.tsx";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />}>
        <Route index element={<Navigate to="/workspace" replace />} />
        <Route path="workspace">
          <Route index element={null} />
          <Route path="spec/:specId" element={null} />
          <Route path="session/:taskId" element={null} />
          <Route path="graph" element={null} />
        </Route>
      </Route>
    </Routes>
  );
}
