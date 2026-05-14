/**
 * Wizard skill registry — declares the hardcoded "wizard chain" UX:
 *
 *   describe → guided chat → live doc → done screen → next wizard
 *
 * A skill in this registry gets:
 *   - the chat+doc split layout (`SessionPanel` left, `WizardDocPanel` right)
 *   - a stepper showing the whole chain with the right step active
 *   - the outcome-driven done screen (`WizardDonePanel`) after end
 *
 * A skill NOT in this registry stays on the regular tab-based flow.
 *
 * ───────────────────────────────────────────────────────────────────
 * Adding a new wizard skill is a 2-step change:
 *
 *   1. Append one entry to {@link WIZARD_CHAIN} below.
 *      Order matters — it defines the stepper progression.
 *
 *   2. In that skill's `SKILL.md`, call the `SessionFinalize` MCP tool
 *      at the end of the skill, with:
 *        - `summary`         — banner shown on the done screen
 *        - `artifacts[]`     — files to open (the live doc, others)
 *        - `actions[]`       — next-step CTAs, queued tickets, navs
 *
 *      `SessionFinalize` also closes the session (END_SIGNAL) so the
 *      runtime emits `agent/done` with the outcome → frontend lands on
 *      the done screen atomically.
 *
 * No other change is required. AppShell, `WizardStepper`,
 * `WizardDocPanel`, and `WizardDonePanel` are all data-driven from here.
 * ───────────────────────────────────────────────────────────────────
 */

import type { SessionStatus } from "@/types/session";

export type WizardStepStatus = "pending" | "active" | "done";

export interface WizardStep {
  label: string;
  status: WizardStepStatus;
}

export interface WizardConfig {
  /** Steps shown in the top stepper. */
  steps: WizardStep[];
  /** Project-relative path to the file previewed in the right pane.
   *  The panel also tries `.bonsai/<basename>` as a fallback. */
  artifactPath: string;
}

interface WizardSkillDef {
  /** Canonical skill ID — must match `task.skill_id` from the backend. */
  id: string;
  /** Optional alternate skill IDs that resolve to this same wizard step
   *  (e.g. `goal-and-requirements` is invoked standalone but shares the
   *  same UI as the `new-project` flow). */
  aliases?: string[];
  /** Project-relative file the live doc panel previews while running. */
  artifact: string;
  /** Label for this wizard's main step in the stepper. */
  step: string;
  /**
   * Optional intro steps shown in this wizard's slot of the stepper,
   * before the main step. Useful for skills that have a meaningful
   * pre-chat phase — e.g. new-project's `Describe` form. The LAST intro
   * step is rendered as "active" while the session is running; the
   * others are always "done".
   */
  introSteps?: string[];
}

function matchesSkill(def: WizardSkillDef, skillId: string): boolean {
  return def.id === skillId || (def.aliases?.includes(skillId) ?? false);
}

/**
 * Wizard chain in execution order. The first wizard's intro steps lead
 * the stepper; the last wizard's main step closes it.
 *
 * To add a new wizard: append an entry. Done.
 */
const WIZARD_CHAIN: WizardSkillDef[] = [
  {
    id: "new-project",
    // `/goal-and-requirements` produces the same artifact via the same
    // UX — invoked standalone when the goal doc already exists.
    aliases: ["goal-and-requirements"],
    artifact: "GOAL&REQUIREMENTS.md",
    step: "Goal & Requirements doc",
    introSteps: ["Describe", "Guided session"],
  },
  {
    id: "architecture-design",
    artifact: "DESIGN_DOC.md",
    step: "Architecture",
  },
  // Add the next wizard here. Examples:
  //   { id: "module-design", artifact: "DESIGN_DOC.md", step: "Module Specs" },
  //   { id: "task-spec",     artifact: "TASKS.md",      step: "Task Specs" },
];

/** Is this skill ID a registered wizard (canonical or aliased)? */
export function isWizardSkill(skillId: string | null | undefined): boolean {
  return skillId != null && WIZARD_CHAIN.some((w) => matchesSkill(w, skillId));
}

/**
 * Resolve the candidate locations to try when reading an artifact file.
 *
 * Skills aren't 100% consistent about whether they pass `FOO.md` or
 * `.bonsai/FOO.md`. Returns the original path plus the root- and
 * `.bonsai/`-prefixed variants, deduplicated, in priority order.
 */
export function artifactPathCandidates(filePath: string): string[] {
  const trimmed = filePath.replace(/^\.bonsai\//, "");
  const seen = new Set<string>();
  return [filePath, trimmed, `.bonsai/${trimmed}`].filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });
}

/**
 * Resolve the wizard config for an active session, or `null` if the
 * skill is not a wizard. The returned `steps` array reflects the
 * session's status — earlier wizards' steps are "done", later wizards'
 * are "pending", and the current wizard's steps follow the running/done
 * progression encoded in {@link WizardSkillDef.introSteps}.
 */
export function getWizardConfig(
  skillId: string | null | undefined,
  status: SessionStatus | undefined,
): WizardConfig | null {
  if (skillId == null) return null;
  const idx = WIZARD_CHAIN.findIndex((w) => matchesSkill(w, skillId));
  if (idx === -1) return null;

  const current = WIZARD_CHAIN[idx];
  const inProgress = status !== "done" && status !== "error";

  const steps: WizardStep[] = [];

  // All wizards before the current one — every step is done.
  for (let i = 0; i < idx; i++) {
    const prior = WIZARD_CHAIN[i];
    for (const intro of prior.introSteps ?? []) {
      steps.push({ label: intro, status: "done" });
    }
    steps.push({ label: prior.step, status: "done" });
  }

  // The current wizard's intro steps. The last one is "active" while
  // the session runs (representing the chat phase); the rest sit at
  // "done" since they happened before the chat started.
  const intros = current.introSteps ?? [];
  for (let i = 0; i < intros.length; i++) {
    const isLast = i === intros.length - 1;
    steps.push({
      label: intros[i],
      status: isLast && inProgress ? "active" : "done",
    });
  }

  // The main step. While intros are still active (i.e. the chat is
  // running), the main step is "pending". Otherwise the main step is
  // where the user's attention is — either no intros (single-phase
  // wizard) or the chat finished and the done screen is showing.
  const mainStatus: WizardStepStatus =
    intros.length > 0 && inProgress ? "pending" : "active";
  steps.push({ label: current.step, status: mainStatus });

  return { steps, artifactPath: current.artifact };
}
