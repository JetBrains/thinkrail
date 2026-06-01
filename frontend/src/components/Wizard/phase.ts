import type { Session } from "@/types/session";
import type { WizardUiPhase } from "./registry";

/**
 * Single source of truth for "what wizard UI phase are we in?".
 *
 * Every place that needs a phase — pre-chat pages (NewProjectForm,
 * ExistingProjectDetect), the AppShell lifecycle hook, anything else
 * future — must call this. Pages must NOT hardcode the phase string;
 * that's how stepper and rendered view drift apart.
 *
 *   - no session yet              → `pre-chat`
 *   - session finished/errored    → `done-screen`
 *   - session in any other state  → `running`
 */
export function derivePhase(args: {
  session: Session | null | undefined;
}): WizardUiPhase {
  const { session } = args;
  if (!session) return "pre-chat";
  if (session.status === "done" || session.status === "error") return "done-screen";
  return "running";
}
