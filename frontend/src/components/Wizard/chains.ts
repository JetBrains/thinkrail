import type { ComponentType } from "react";
import type { ProjectState } from "@/store/uiStore";
import { ExistingProjectDetect } from "@/components/ProjectPicker/ExistingProjectDetect";
import { NewProjectForm } from "./NewProjectForm";

/**
 * Each wizard chain owns a pre-chat page — a fullscreen form/scan
 * rendered before any session exists. The chain ID also drives the
 * stepper-label selection in {@link getWizardConfig} when a wizard
 * participates in multiple chains.
 *
 * Adding a new chain is a single-table change here — AppShell does NOT
 * branch on chain identity; it looks up `preChatComponent` by
 * `triggerProjectState` and renders whatever the table says.
 */
export interface ChainConfig {
  /** Chain ID — must match the `chains[]` entries in `registry.ts`. */
  id: string;
  /**
   * Fullscreen component rendered during the pre-chat phase of this
   * chain. The component is responsible for:
   *   - displaying its own `WizardStepper` (via `getWizardConfig`)
   *   - calling `setCurrentChain(id)` on mount so subsequent stepper
   *     resolution picks the right chain
   *   - starting the first session of the chain on user action.
   */
  preChatComponent: ComponentType;
  /**
   * AppShell selects this chain's pre-chat when the global
   * `projectState` equals this value AND no session/files are open.
   * The mapping is intentionally 1-1: each ProjectState value triggers
   * at most one chain's pre-chat. If you need conditional logic
   * beyond a single ProjectState, extend this interface — don't move
   * the decision into AppShell.
   */
  triggerProjectState: ProjectState;
}

const CHAINS: ChainConfig[] = [
  {
    id: "new-project",
    preChatComponent: NewProjectForm,
    triggerProjectState: "new",
  },
  {
    id: "investigate-project",
    preChatComponent: ExistingProjectDetect,
    triggerProjectState: "existing",
  },
];

/** Chain whose pre-chat should fire for the given project state, or null. */
export function chainForProjectState(
  state: ProjectState | null,
): ChainConfig | null {
  if (!state) return null;
  return CHAINS.find((c) => c.triggerProjectState === state) ?? null;
}

/** All registered chain IDs. Used by invariant tests. */
export function knownChainIds(): string[] {
  return CHAINS.map((c) => c.id);
}
