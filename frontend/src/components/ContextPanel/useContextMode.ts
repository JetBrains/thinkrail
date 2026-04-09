import { useSessionStore } from "@/store/sessionStore.ts";
import { useFileStore } from "@/store/fileStore.ts";
import { useSpecStore } from "@/store/specStore.ts";

export type ContextMode = "spec" | "agent" | "code" | "empty";

function isSpecFile(path: string): boolean {
  if (path.includes("/.bonsai/")) return true;
  if (path.startsWith(".bonsai/")) return true;
  const specs = useSpecStore.getState().specs;
  return specs.some((s) => path === s.path || path.endsWith(`/${s.path}`));
}

export function useContextMode(): ContextMode {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeFilePath = useFileStore((s) => s.activeFilePath);
  const previewFilePath = useFileStore((s) => s.previewFilePath);
  const selectedSpecId = useSpecStore((s) => s.selectedSpecId);

  // Only one of these is active at a time (mutually exclusive in the store layer)
  const focusedFile = previewFilePath ?? activeFilePath;

  if (focusedFile) return isSpecFile(focusedFile) ? "spec" : "code";
  if (activeSessionId) return "agent";
  if (selectedSpecId) return "spec";
  return "empty";
}
