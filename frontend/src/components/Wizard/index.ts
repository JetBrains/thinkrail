/**
 * Wizard flow — guided spec-driven skill chain.
 *
 * The wizard lifecycle is owned by `useWizardLifecycle()`: it returns
 * a discriminated `WizardLifecycleState` derived from the global
 * stores. AppShell branches on `state.kind` — there is no other
 * correct place to combine `projectState` / `activeSession.status` /
 * `outcome` / `dismissed` / `centerView` into a rendering decision.
 *
 * Public surface (for AppShell and adjacent UI):
 *   - `useWizardLifecycle`  — the state hook driving render branches
 *   - `WizardStepper`       — top stepper, data-driven from `WizardStep[]`
 *   - `WizardDocPanel`      — right-side live doc preview
 *   - `WizardDonePanel`     — outcome-driven done screen
 *   - `getWizardConfig`     — resolves stepper + artifact for a (skill,
 *                             phase, chain) tuple
 *   - `isWizardSkill`       — registry membership check
 *   - `derivePhase`         — single source of truth for "what phase
 *                             am I in?" (don't hardcode strings)
 *
 * Adding a new wizard: see comment block atop `registry.ts`.
 * Adding a new chain: see comment block atop `chains.ts`.
 */
export { WizardStepper } from "./WizardStepper";
export { WizardDocPanel } from "./WizardDocPanel";
export { WizardDonePanel } from "./WizardDonePanel";
export { useWizardLifecycle, type WizardLifecycleState } from "./useWizardLifecycle";
export { useStartWizardStep, type StartWizardStepOpts } from "./useStartWizardStep";
export { derivePhase } from "./phase";
export {
  artifactPathCandidates,
  getWizardConfig,
  stepperFromJourney,
  isWizardSkill,
  chainsForSkill,
  resolveFollowupChain,
  entryTransition,
  outcomeTransitions,
  type WizardConfig,
  type WizardStep,
  type WizardStepStatus,
  type WizardUiPhase,
  type StepTransition,
  type StepPromptContext,
  type JourneyEntry,
} from "./registry";
