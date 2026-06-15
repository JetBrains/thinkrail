import { useUiStore } from "@/store/uiStore";
import { useSessionStore } from "@/store/sessionStore";
import { useFileStore } from "@/store/fileStore";
import { isWizardSkill } from "./registry";
import { derivePhase } from "./phase";
import { chainForProjectState, type ChainConfig } from "./chains";
import type { Session, SessionOutcome } from "@/types/session";

/**
 * Discriminated union representing the wizard chain's current state,
 * derived from the global stores in one place.
 *
 * AppShell renders ONE view per kind. Adding a new wizard rendering
 * state means adding a new kind here — that's the contract. No more
 * cobbling together booleans from projectState + activeSession.status
 * + outcome + dismissed + centerView across multiple if-branches.
 */
export type WizardLifecycleState =
  /** Project state hasn't loaded yet — show a loader. */
  | { kind: "loading" }
  /** No wizard active — fall through to the regular layout. */
  | { kind: "none" }
  /**
   * Pre-chat onboarding takeover. The chain's `preChatComponent` is
   * rendered fullscreen; the session that follows starts from within
   * that component.
   */
  | { kind: "pre-chat"; chain: ChainConfig }
  /** A wizard chat+doc session is running. */
  | {
      kind: "running";
      session: Session;
      activeSessionId: string;
      chainHint: string | null;
    }
  /** A wizard session finished with a result the user hasn't dismissed. */
  | {
      kind: "done-screen";
      session: Session;
      activeSessionId: string;
      outcome: SessionOutcome;
      chainHint: string | null;
    };

export function useWizardLifecycle(): WizardLifecycleState {
  const projectState = useUiStore((s) => s.projectState);
  const currentChain = useUiStore((s) => s.currentChain);
  const dismissedOutcomes = useUiStore((s) => s.dismissedWizardOutcomes);
  const centerView = useUiStore((s) => s.centerView);

  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const openFiles = useFileStore((s) => s.openFiles);

  if (projectState === null) return { kind: "loading" };

  const activeSession = activeSessionId ? sessions.get(activeSessionId) ?? null : null;
  const phase = derivePhase({ session: activeSession });

  // Pre-chat onboarding takeover — no session, no open files, and the
  // current ProjectState maps to a registered chain's trigger. Note
  // `centerView` is intentionally ignored here: pre-chat happens
  // before the user can have selected a tab.
  if (phase === "pre-chat" && openFiles.size === 0) {
    const chain = chainForProjectState(projectState);
    if (chain) return { kind: "pre-chat", chain };
    return { kind: "none" };
  }

  // Wizard chat/done takeovers only apply on the Sessions tab —
  // clicking Board in the header is the opt-out path.
  if (centerView !== "sessions") return { kind: "none" };
  if (!activeSession || !activeSessionId) return { kind: "none" };
  if (!isWizardSkill(activeSession.skillId)) return { kind: "none" };

  if (phase === "done-screen") {
    if (activeSession.outcome && !dismissedOutcomes.includes(activeSessionId)) {
      return {
        kind: "done-screen",
        session: activeSession,
        activeSessionId,
        outcome: activeSession.outcome,
        chainHint: currentChain,
      };
    }
    return { kind: "none" };
  }

  return {
    kind: "running",
    session: activeSession,
    activeSessionId,
    chainHint: currentChain,
  };
}
