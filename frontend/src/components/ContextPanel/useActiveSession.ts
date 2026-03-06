import { useSessionStore } from "@/store/sessionStore.ts";
import type { Session } from "@/types/session.ts";

export function useActiveSession(): Session | null {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  if (!activeSessionId) return null;
  return sessions.get(activeSessionId) ?? null;
}
