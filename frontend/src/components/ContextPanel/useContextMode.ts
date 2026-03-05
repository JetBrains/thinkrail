import { useSessionStore } from "@/store/sessionStore.ts";
import { useFileStore } from "@/store/fileStore.ts";
import { useSpecStore } from "@/store/specStore.ts";

export type ContextMode = "spec" | "agent" | "code" | "empty";

function isSpecFile(path: string): boolean {
  if (path.includes("/.specs/")) return true;
  if (path.startsWith(".specs/")) return true;
  const specs = useSpecStore.getState().specs;
  return specs.some((s) => path === s.path || path.endsWith(`/${s.path}`));
}

export function useContextMode(): ContextMode {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeFilePath = useFileStore((s) => s.activeFilePath);
  const selectedSpecId = useSpecStore((s) => s.selectedSpecId);

  if (activeSessionId) return "agent";
  if (activeFilePath && isSpecFile(activeFilePath)) return "spec";
  if (activeFilePath) return "code";
  if (selectedSpecId) return "spec";
  return "empty";
}
