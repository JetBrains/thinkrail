import { useCallback } from "react";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useUiStore } from "@/store/uiStore.ts";
import { buildDefaultSessionConfig } from "@/utils/sessionConfig.ts";

/**
 * Start a wizard session AND register it on the cumulative stepper
 * journey in one call. Every wizard entry/follow-up start goes through
 * here so the three concerns can't drift apart: pinning the active
 * chain, seeding the journey, and kicking the session. Forgetting any
 * one of them silently breaks the top stepper (it falls back to the
 * chain-based config), so they live behind a single helper.
 *
 * Errors propagate — callers keep their own try/catch for UI state
 * (busy flags, project-state rollback).
 */
export interface StartWizardStepOpts {
  /** Canonical skill id of the session to start. */
  skillId: string;
  /** Chain the session belongs to (its origin chain for entry steps,
   *  the resolved follow-up chain otherwise — see `resolveFollowupChain`). */
  chainId: string | null;
  /** Session display name. */
  name: string;
  /** `session_prompt` (the agent's "## Your Task"), if any. */
  prompt?: string;
  /** First user message that kicks off the conversation loop. */
  kick: string;
}

export function useStartWizardStep(): (opts: StartWizardStepOpts) => Promise<string> {
  const startSession = useSessionStore((s) => s.startSession);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const setCurrentChain = useUiStore((s) => s.setCurrentChain);
  const appendWizardStep = useUiStore((s) => s.appendWizardStep);

  return useCallback(
    async ({ skillId, chainId, name, prompt, kick }: StartWizardStepOpts) => {
      // Pin the chain before the session becomes active so its stepper
      // cells resolve to the right labels on first render.
      setCurrentChain(chainId);
      const thinkrailSid = await startSession({
        specIds: [],
        config: await buildDefaultSessionConfig(),
        name,
        skillId,
        prompt,
      });
      appendWizardStep({ thinkrailSid, skillId, chainId });
      // The runtime waits for a user message before starting its loop;
      // the real task lives in `prompt` above, so the kick is minimal.
      await sendMessage(thinkrailSid, kick);
      return thinkrailSid;
    },
    [startSession, sendMessage, setCurrentChain, appendWizardStep],
  );
}
