import { useFileStore } from "@/store/fileStore.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";

export type ActiveTabKind = "ticket" | "file" | "session" | "none";

/**
 * Single source of truth for which tab kind is active in the Sessions view.
 * Precedence: file > ticket > session. Embedded SessionPanels (ticket route /
 * wizard) never show ticket UI, so they collapse to session/none.
 */
export function useActiveTabKind(opts?: { embedded?: boolean }): ActiveTabKind {
  const activeFilePath = useFileStore((s) => s.activeFilePath);
  const previewFilePath = useFileStore((s) => s.previewFilePath);
  const activeTicketId = useBoardStore((s) => s.activeTicketId);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  if (activeFilePath != null || previewFilePath != null) return "file";
  if (!opts?.embedded && activeTicketId != null) return "ticket";
  if (activeSessionId != null) return "session";
  return "none";
}
