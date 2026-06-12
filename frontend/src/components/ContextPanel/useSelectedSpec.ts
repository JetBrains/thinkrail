import { useFileStore } from "@/store/fileStore.ts";
import { useSpecStore } from "@/store/specStore.ts";
import type { SpecEntry } from "@/types/spec.ts";

function isSpecFile(path: string): boolean {
  if (path.includes("/.tr/")) return true;
  if (path.startsWith(".tr/")) return true;
  const specs = useSpecStore.getState().specs;
  return specs.some((s) => path === s.path || path.endsWith(`/${s.path}`));
}

export function useSelectedSpec(): SpecEntry | null {
  const activeFilePath = useFileStore((s) => s.activeFilePath);
  const previewFilePath = useFileStore((s) => s.previewFilePath);
  const specs = useSpecStore((s) => s.specs);
  const selectedSpecId = useSpecStore((s) => s.selectedSpecId);

  const focusedFile = previewFilePath ?? activeFilePath;

  if (focusedFile && isSpecFile(focusedFile)) {
    return specs.find((s) => focusedFile === s.path || focusedFile.endsWith(`/${s.path}`)) ?? null;
  }
  if (selectedSpecId) {
    return specs.find((s) => s.id === selectedSpecId) ?? null;
  }
  return null;
}
