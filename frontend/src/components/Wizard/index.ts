/**
 * Wizard flow — guided spec-driven skill chain.
 *
 * Public surface:
 *   - `NewProjectForm`    — the "Describe" step (form before chat)
 *   - `WizardStepper`     — top stepper, data-driven from `WizardStep[]`
 *   - `WizardDocPanel`    — right-side live doc preview
 *   - `WizardDonePanel`   — outcome-driven done screen (banner / CTAs / tickets / doc)
 *   - `isWizardSkill`     — registry membership check
 *   - `getWizardConfig`   — resolves stepper + artifact for a session
 *
 * Adding a new wizard: see comment block atop `registry.ts`.
 */
export { NewProjectForm } from "./NewProjectForm";
export { WizardStepper } from "./WizardStepper";
export { WizardDocPanel } from "./WizardDocPanel";
export { WizardDonePanel } from "./WizardDonePanel";
export {
  artifactPathCandidates,
  getWizardConfig,
  isWizardSkill,
  type WizardConfig,
  type WizardStep,
  type WizardStepStatus,
} from "./registry";
