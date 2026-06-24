/**
 * Wizard flow registry — the SINGLE SOURCE OF TRUTH for the guided
 * onboarding chains. Everything about a flow lives here: which sessions
 * run, in what order, what skill each runs, what artifact it produces,
 * the stepper labels, and the prompt that starts each session.
 *
 * ───────────────────────────────────────────────────────────────────
 * The model: a flow is a sequence of `SessionStep`s.
 *
 * Each `SessionStep` runs ONE skill session and contributes up to three
 * cells to the stepper — one per UI phase that has a distinct screen:
 *
 *   pre-chat   → the entry form/scan page (only entry steps have one)
 *   running    → the chat+doc split layout while the session runs
 *   done-screen→ the Session Outcome screen (`WizardDonePanel`)
 *
 * So screens and stepper cells map 1:1: every screen the user can see is
 * exactly one cell, and the Session Outcome is its OWN cell. The active
 * cell is `(current step, current phase)` — there is one global active
 * index, so the stepper and the rendered screen CANNOT drift.
 *
 * ───────────────────────────────────────────────────────────────────
 * Prompts live on the EDGE, not the node.
 *
 * The same skill can be entered along different edges with different
 * prompts (e.g. `new-project` entered as "Describe" with the user's
 * idea, vs. as "Clarify" with the investigation's draft G&R). So a
 * session's `session_prompt` is built by the `StepTransition` that
 * starts it — `enter` for the first step of a chain (invoked by the
 * pre-chat page), or an `outcomeActions[]` entry for follow-ups
 * (rendered as CTAs on the previous step's Session Outcome). A
 * transition with no `buildPrompt` starts the session with no extra
 * prompt — the skill's `SKILL.md` alone drives it.
 *
 * ───────────────────────────────────────────────────────────────────
 * Adding a wizard: append a `SessionStep` to {@link WIZARD_FLOW}, give
 * it a `chains` membership, and wire its `enter` / `outcomeActions`
 * prompt builders. The matching skill must call `SessionFinalize` at the
 * end of its `SKILL.md` to emit the Session Outcome (summary, artifacts,
 * suggested tickets) and close the session.
 * ───────────────────────────────────────────────────────────────────
 */

import type { ComponentType } from "react";

export type WizardStepStatus = "pending" | "active" | "done";

/**
 * UI phase the wizard rendering layer is currently in. Each phase that
 * has a distinct screen contributes one stepper cell per session step.
 *
 *   - `pre-chat`    : a form/scan page shown before any session exists
 *                     (NewProjectForm, ExistingProjectDetect).
 *   - `running`     : the chat+doc split layout for an active session.
 *   - `done-screen` : the Session Outcome screen (`WizardDonePanel`).
 */
export type WizardUiPhase = "pre-chat" | "running" | "done-screen";

export interface WizardStep {
  label: string;
  status: WizardStepStatus;
  icon?: string;
}

export interface WizardConfig {
  /** Steps shown in the top stepper. */
  steps: WizardStep[];
  /** Project-relative path to the file previewed in the right pane.
   *  The panel also tries `.tr/<basename>` as a fallback. */
  artifactPath: string;
}

/**
 * One wizard session the user has actually entered, in launch order.
 * The stepper is built from this list (see {@link stepperFromJourney})
 * rather than walked from a single chain graph — so the journey stays
 * cumulative across chain boundaries (e.g. investigate → Clarify →
 * Architecture) instead of resetting when the chain changes.
 *
 * `chainId` is the chain the session belongs to AT LAUNCH — it
 * disambiguates skills that live in multiple chains (e.g. `new-project`
 * is the greenfield "Describe" step under chain "new-project" but the
 * "Clarify" step under chain "investigate-project").
 */
export interface JourneyEntry {
  thinkrailSid: string;
  skillId: string;
  chainId: string | null;
}

/**
 * Runtime values a transition's prompt builder may weave into the
 * `session_prompt`. The prompt is built fresh each time a session
 * starts, so it can incorporate live data (the idea typed into the
 * form, the files selected on the scan page, or the document the
 * previous step produced).
 */
export interface StepPromptContext {
  projectName: string;
  /** Free-form text an entry form collected (idea, attached doc). */
  ideaText?: string;
  /** Paths the user selected on a scan page. */
  selectedPaths?: readonly string[];
  /** Contents of prior-step artifacts, keyed by project-relative path. */
  artifacts?: Readonly<Record<string, string>>;
}

/**
 * An edge that starts a session step. Carries the prompt — see the
 * file header on why prompts live on edges, not nodes.
 */
export interface StepTransition {
  /** Stable id (unique within its step). */
  id: string;
  /** CTA label shown on the previous step's Session Outcome. Entry
   *  transitions (`enter`) don't render a CTA, so the label is unused
   *  there but kept for symmetry/debugging. */
  label: string;
  description?: string;
  /** Canonical skill id of the step this transition starts. */
  target: string;
  /** lucide-react icon name shown on the outcome-screen CTA card. */
  icon?: string;
  /** Marks the headline CTA on the outcome screen. */
  primary?: boolean;
  /** Build the `session_prompt` from runtime context. Omit → the
   *  session starts with no extra prompt (SKILL.md alone drives it). */
  buildPrompt?: (ctx: StepPromptContext) => string;
}

/**
 * One session in a wizard flow. Owns its stepper cells (one per phase
 * that has a distinct screen) plus the edges in/out of it.
 *
 * A skill that appears in multiple chains with different cells (e.g.
 * `new-project` is "Describe/Guided session/Goal & Requirements doc" in
 * the new-project chain, but "Clarify/Verify & save" in the investigate
 * chain) gets one `SessionStep` per chain.
 */
interface SessionStep {
  /** Canonical skill id — must match `task.skill_id` from the backend. */
  id: string;
  /** Alternate skill ids resolving to this step (e.g.
   *  `goal-and-requirements` ≡ `new-project`). */
  aliases?: string[];
  /** Project-relative file the live-doc panel previews + the artifact
   *  this step produces. */
  artifact: string;
  /** Chains this step belongs to (chain id = first step's skill id). */
  chains: string[];
  /** Entry page rendered during `pre-chat`. Only entry steps have one;
   *  follow-up steps start from the previous step's outcome CTA. */
  preChat?: { label: string; component?: ComponentType };
  /** Stepper label while the session runs (`running` phase). */
  runningLabel: string;
  /** Stepper label for the Session Outcome (`done-screen` phase). */
  outcomeLabel: string;
  /** Edge that ENTERS this step — builds its `session_prompt`. For
   *  entry steps the pre-chat page invokes it; for follow-ups it's the
   *  matching `outcomeActions` entry on the previous step. */
  enter?: StepTransition;
  /** CTAs shown on this step's Session Outcome that start the next
   *  session. Each `target`s another step in the chain. */
  outcomeActions?: StepTransition[];
}

function matchesSkill(step: SessionStep, skillId: string): boolean {
  return step.id === skillId || (step.aliases?.includes(skillId) ?? false);
}

// ── Prompt builders ──────────────────────────────────────────────────
// Kept next to the flow they belong to so the registry stays the single
// source. Pre-chat pages collect the raw inputs and pass them via
// StepPromptContext; the builder turns them into the session_prompt.

/** new-project "Describe" entry: the user's idea + attached doc. */
function buildDescribePrompt(ctx: StepPromptContext): string {
  const parts: string[] = [`Project name: ${ctx.projectName}`];
  if (ctx.ideaText?.trim()) parts.push(ctx.ideaText.trim());
  return parts.join("\n\n");
}

/** investigate "What we'll read" entry: project + selected file paths. */
function buildInvestigatePrompt(ctx: StepPromptContext): string {
  const fileLines = (ctx.selectedPaths ?? []).map((s) => `- ${s}`).join("\n");
  return [
    `Project: ${ctx.projectName}`,
    "",
    "Selected files (start your code reading here, then follow imports outward):",
    fileLines,
  ].join("\n");
}

/** Find an artifact body by basename, tolerating `.tr/` prefixes. */
function artifactBody(
  artifacts: StepPromptContext["artifacts"],
  basename: string,
): string | undefined {
  if (!artifacts) return undefined;
  const want = basename.toLowerCase();
  for (const [path, body] of Object.entries(artifacts)) {
    if (body && path.toLowerCase().replace(/^\.tr\//, "").endsWith(want)) {
      return body;
    }
  }
  return undefined;
}

/**
 * investigate → Clarify hand-off. The Investigation session inferred a
 * draft GOAL&REQUIREMENTS.md from code only; the Clarify session refines
 * it with the user. The instruction block is static; the only runtime
 * input is the draft body, pulled from the artifact the Investigation
 * step produced. (Mirrors the prompt the investigate skill used to emit
 * via `SessionFinalize` — now owned here so the flow lives in one place.)
 */
function buildClarifyPrompt(ctx: StepPromptContext): string {
  const draft = artifactBody(ctx.artifacts, "GOAL&REQUIREMENTS.md");
  const instructions = [
    "⚠️ Onboarding hand-off — these sections were inferred from CODE ONLY by the previous Investigation session. They are educated guesses, not verified intent. Treat them as a starting point, not as confirmed content.",
    "",
    "Your job in this Clarify session:",
    '  • For every section below, ask the user whether the inference is correct. Be specific — propose what\'s there and ask "Is this right, or should I rewrite?".',
    "  • **Save each section the moment it's confirmed.** As soon as the user approves a section (whether unchanged or after a rewrite), `spec_save` that one section immediately — before moving to the next question. Do NOT batch saves to the end: the document must always reflect what the user just confirmed. If you rewrite the Overview and the user says \"looks right\", the very next action is `spec_save` of that Overview.",
    "  • The Open Questions section lists gaps the code couldn't fill. Walk those one by one with `AskUserQuestion`. These are the must-asks.",
    "  • Goals and Target Users especially need real user input — code rarely reveals intent. Probe deeper if the user gives short answers.",
    "  • DESIGN_DOC.md is already done from code. Do NOT touch it — the architecture facts are stable.",
    '  • Once every section has been confirmed and saved, do a final `spec_save` that promotes frontmatter `status: "draft"` → `status: "done"`. This is only the status flip — the section content was already persisted as you went.',
  ].join("\n");
  const draftBlock = draft
    ? `\n\n--- Draft GOAL&REQUIREMENTS.md (inferred from code) ---\n${draft}`
    : "";
  return instructions + draftBlock;
}

// Shared "Define architecture" hand-off. No prompt: the
// architecture-design skill reads GOAL&REQUIREMENTS.md from disk itself
// (matches the action the new-project skill used to emit). Targets the
// new-project chain, so starting it resets the chain hint.
const TO_ARCHITECTURE: StepTransition = {
  id: "to-architecture",
  label: "Define architecture",
  description: "Sketch the stack & modules in a DESIGN_DOC.md before tickets start running.",
  target: "architecture-design",
  icon: "pencil-ruler",
  primary: true,
};

/**
 * Flow steps, in execution order, across all chains. The first step of
 * each chain leads its stepper; the last step closes it.
 */
const WIZARD_FLOW: SessionStep[] = [
  // ── Chain: new-project (greenfield idea → code) ───────────────────
  {
    id: "new-project",
    // `/goal-and-requirements` produces the same artifact via the same
    // UX — invoked standalone when the goal doc already exists.
    aliases: ["goal-and-requirements"],
    artifact: "GOAL&REQUIREMENTS.md",
    chains: ["new-project"],
    preChat: { label: "Describe project" },
    runningLabel: "Define goals",
    outcomeLabel: "Goals ready",
    enter: {
      id: "new-project.enter",
      label: "Describe project",
      target: "new-project",
      buildPrompt: buildDescribePrompt,
    },
    // "Define architecture" is the headline CTA on the G&R outcome.
    outcomeActions: [TO_ARCHITECTURE],
  },
  {
    id: "architecture-design",
    artifact: "DESIGN_DOC.md",
    chains: ["new-project"],
    runningLabel: "Define architecture",
    outcomeLabel: "Architecture ready",
  },

  // ── Chain: investigate-project (existing-project onboarding) ──────
  //
  // Investigation runs the `investigate-project` skill — a code-first
  // variant whose output is a DESIGN_DOC.md derived from the codebase
  // plus a draft GOAL&REQUIREMENTS.md handed to the Clarify session.
  {
    id: "investigate-project",
    artifact: "DESIGN_DOC.md",
    chains: ["investigate-project"],
    preChat: { label: "Select files" },
    runningLabel: "Investigation",
    outcomeLabel: "Review",
    enter: {
      id: "investigate-project.enter",
      label: "Select files",
      target: "investigate-project",
      buildPrompt: buildInvestigatePrompt,
    },
    outcomeActions: [
      {
        id: "investigate-project.to-clarify",
        label: "Continue → Clarify the G&R draft",
        description: "Refine the inferred draft into a final GOAL&REQUIREMENTS.md by answering what the code couldn't.",
        target: "new-project",
        icon: "diamond-plus",
        primary: true,
        buildPrompt: buildClarifyPrompt,
      },
    ],
  },
  {
    // Clarify follow-up. Same skill as new-project (alias
    // goal-and-requirements) — its Step 0.5 fast-path consumes the draft
    // G&R passed via session_prompt. Distinct stepper cells from the
    // new-project chain, hence a separate SessionStep. Its outcome hands
    // off to Architecture (a new-project-chain step → cross-chain, the
    // chain hint resets when it starts).
    id: "new-project",
    aliases: ["goal-and-requirements"],
    artifact: "GOAL&REQUIREMENTS.md",
    chains: ["investigate-project"],
    runningLabel: "Clarify",
    outcomeLabel: "Verify & save",
    outcomeActions: [TO_ARCHITECTURE],
  },
];

const DEFAULT_CHAIN_ID = "new-project";

/**
 * Every chain the given skill participates in. Used by the done-screen
 * handler to decide whether to keep the active chain hint when starting
 * a follow-up session: if the next skill is in the same chain (e.g.
 * new-project Clarify within the investigate chain), keep the hint and
 * the stepper stays continuous; otherwise reset.
 */
export function chainsForSkill(skillId: string): string[] {
  const out = new Set<string>();
  for (const s of WIZARD_FLOW) {
    if (matchesSkill(s, skillId)) for (const c of s.chains) out.add(c);
  }
  return Array.from(out);
}

/**
 * The chain a follow-up session belongs to when launched from a
 * done-screen. Keep the current chain if the target step lives in it
 * (e.g. the Clarify follow-up stays in the investigate chain), else fall
 * back to the target's own first chain (e.g. Clarify → Architecture
 * crosses into the new-project chain). This is the single source for the
 * "which chain does the next session resolve to" decision — callers
 * (e.g. `WizardDonePanel`) must not re-derive it.
 */
export function resolveFollowupChain(
  currentChain: string | null,
  targetSkillId: string,
): string | null {
  const targetChains = chainsForSkill(targetSkillId);
  if (currentChain && targetChains.includes(currentChain)) return currentChain;
  return targetChains[0] ?? null;
}

/** Is this skill ID a registered wizard (canonical or aliased)? */
export function isWizardSkill(skillId: string | null | undefined): boolean {
  return skillId != null && WIZARD_FLOW.some((s) => matchesSkill(s, skillId));
}

/**
 * Resolve the candidate locations to try when reading an artifact file.
 *
 * Skills aren't 100% consistent about whether they pass `FOO.md` or
 * `.tr/FOO.md`. Returns the original path plus the root- and
 * `.tr/`-prefixed variants, deduplicated, in priority order.
 */
export function artifactPathCandidates(filePath: string): string[] {
  const trimmed = filePath.replace(/^\.tr\//, "");
  const seen = new Set<string>();
  return [filePath, trimmed, `.tr/${trimmed}`].filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });
}

/** Resolve the `SessionStep` for a (skill, chain) pair, or null. */
function resolveStep(
  skillId: string,
  chainId?: string,
): SessionStep | null {
  const candidates = WIZARD_FLOW.filter((s) => matchesSkill(s, skillId));
  if (candidates.length === 0) return null;
  return (
    (chainId ? candidates.find((s) => s.chains.includes(chainId)) : undefined) ??
    candidates[0]
  );
}

/** Steps of a chain, in flow order. */
function chainSteps(chainId: string): SessionStep[] {
  return WIZARD_FLOW.filter((s) => s.chains.includes(chainId));
}

/**
 * Map step label to its lucide-react icon name.
 */
const STEP_ICONS: Record<string, string> = {
  "Describe project": "grid-2x2-plus",
  "Define goals": "target",
  "Goals ready": "book-check",
  "Define architecture": "pencil-ruler",
  "Architecture ready": "pencil-ruler",
  "Select files": "file-text",
  "Investigation": "brain",
  "Review": "eye",
  "Clarify": "diamond-plus",
  "Verify & save": "badge-check",
};

/**
 * One stepper cell, tagged with its owner and phase. `ownerIdx` is the
 * index of the thing the cell belongs to — a step within a chain walk
 * (`getWizardConfig`) or a session within the journey
 * (`stepperFromJourney`). Both build the same cell list, so they share
 * {@link cellsToSteps} for the active-cell + status assignment.
 */
interface StepperCell {
  label: string;
  ownerIdx: number;
  phase: WizardUiPhase;
}

/**
 * Map stepper cells to `WizardStep[]`, marking the cell at
 * `(activeOwnerIdx, phase)` active, everything before it `done`, after
 * it `pending`. Falls back to the owner's `running` cell when it has no
 * cell for `phase` (defensive — shouldn't happen for reachable screens).
 */
function cellsToSteps(
  cells: readonly StepperCell[],
  activeOwnerIdx: number,
  phase: WizardUiPhase,
): WizardStep[] {
  let activeIdx = cells.findIndex(
    (c) => c.ownerIdx === activeOwnerIdx && c.phase === phase,
  );
  if (activeIdx < 0) {
    activeIdx = cells.findIndex(
      (c) => c.ownerIdx === activeOwnerIdx && c.phase === "running",
    );
  }
  return cells.map((c, i) => ({
    label: c.label,
    status: i < activeIdx ? "done" : i === activeIdx ? "active" : "pending",
    icon: STEP_ICONS[c.label],
  }));
}

/**
 * The step a `step`'s outcome hands off to WITHIN the given chain, by
 * following its `outcomeActions` edge. Cross-chain edges (e.g. Clarify →
 * Architecture) return `undefined` here — they end the current chain's
 * path. This is the single place that reads the flow graph's edges.
 */
function nextInChain(step: SessionStep, chainId: string): SessionStep | undefined {
  for (const action of step.outcomeActions ?? []) {
    const target = WIZARD_FLOW.find(
      (s) =>
        (s.id === action.target || (s.aliases ?? []).includes(action.target)) &&
        s.chains.includes(chainId),
    );
    if (target) return target;
  }
  return undefined;
}

/**
 * The ordered steps the user has reached: walk the chain from its entry
 * step along the transition edges until we arrive at `current`. The
 * graph (not array position) defines both order and how far the stepper
 * is revealed — downstream steps stay hidden until their session starts.
 */
function reachedSteps(chainId: string, current: SessionStep): SessionStep[] {
  const path: SessionStep[] = [];
  const seen = new Set<SessionStep>();
  let node: SessionStep | undefined = chainSteps(chainId)[0]; // entry step
  while (node && !seen.has(node)) {
    seen.add(node);
    path.push(node);
    if (node === current) return path;
    node = nextInChain(node, chainId);
  }
  // Defensive: the walk never reached `current` (mis-wired graph) — show
  // just the current step so its active cell still renders.
  return [current];
}

/** Flatten an ordered list of steps into their stepper cells. */
function flattenSteps(steps: readonly SessionStep[]): StepperCell[] {
  const cells: StepperCell[] = [];
  steps.forEach((step, ownerIdx) => {
    if (step.preChat) {
      cells.push({ label: step.preChat.label, ownerIdx, phase: "pre-chat" });
    }
    cells.push({ label: step.runningLabel, ownerIdx, phase: "running" });
    cells.push({ label: step.outcomeLabel, ownerIdx, phase: "done-screen" });
  });
  return cells;
}

/**
 * Resolve the wizard config (stepper + artifact) for a given skill in a
 * given UI phase. Returns `null` if the skill is not a registered
 * wizard.
 *
 * The stepper is built PROGRESSIVELY: only the steps up to and including
 * the current one are shown. Downstream sessions are conditional (the
 * user may Skip from a done-screen instead of continuing), so their
 * cells appear only once that session actually starts — at which point
 * it becomes the current step and its cells are revealed. This is why
 * the investigate flow shows 3 cells (What we'll read → Investigation →
 * Review) until the user clicks "Continue → Clarify", which adds Clarify.
 *
 * The active cell is exactly `(current step, phase)`. Everything before
 * it is `done`. Because every step owns a cell for every phase it can be
 * in, this mapping is total — the stepper and the rendered screen cannot
 * drift.
 *
 * @param skillId  Skill ID of the step currently rendered (canonical or
 *                 alias).
 * @param phase    UI phase the rendering layer is in.
 * @param chainId  Optional chain hint when a skill participates in
 *                 multiple chains. Falls back to the skill's first chain.
 */
export function getWizardConfig(
  skillId: string | null | undefined,
  phase: WizardUiPhase,
  chainId?: string,
): WizardConfig | null {
  if (skillId == null) return null;
  const current = resolveStep(skillId, chainId);
  if (!current) return null;

  const resolvedChain = chainId ?? current.chains[0] ?? DEFAULT_CHAIN_ID;

  // Visible stepper = the path traversed to reach `current`, walked
  // along the flow's transition edges. The walk ends at `current`, so it
  // is always the last visible step.
  const visible = reachedSteps(resolvedChain, current);
  const currentIdx = visible.length - 1;
  const steps = cellsToSteps(flattenSteps(visible), currentIdx, phase);
  return { steps, artifactPath: current.artifact };
}

/**
 * Build the cumulative stepper from the user's actual session journey.
 *
 * Unlike {@link getWizardConfig} (which walks ONE chain graph from its
 * entry and resets on chain changes), this flattens every session the
 * user has launched, in order, into stepper cells — so the journey keeps
 * growing across chain boundaries instead of being overwritten. Each
 * session contributes its cells: a `pre-chat` cell only if it's an entry
 * step with a custom window (e.g. "What we'll read" / "Describe"), plus
 * a `running` cell (the session) and a `done-screen` cell (its outcome).
 *
 * The active cell is `(active session, current phase)`; everything
 * before it is `done`, everything after is `pending`.
 *
 * Returns `null` for an empty journey — callers fall back to the
 * chain-based {@link getWizardConfig} (used for the pre-chat preview,
 * before any session exists).
 */
export function stepperFromJourney(
  journey: readonly JourneyEntry[],
  activeSid: string | null,
  phase: WizardUiPhase,
): WizardConfig | null {
  const resolved = journey
    .map((entry) => ({ entry, step: resolveStep(entry.skillId, entry.chainId ?? undefined) }))
    .filter((r): r is { entry: JourneyEntry; step: SessionStep } => r.step != null);
  if (resolved.length === 0) return null;

  // Active entry = the journey item for the active session; fall back to
  // the last item (the normal case — you just launched it).
  let activeEntryIdx = resolved.findIndex((r) => r.entry.thinkrailSid === activeSid);
  if (activeEntryIdx < 0) activeEntryIdx = resolved.length - 1;

  const steps = cellsToSteps(
    flattenSteps(resolved.map((r) => r.step)),
    activeEntryIdx,
    phase,
  );
  return { steps, artifactPath: resolved[activeEntryIdx].step.artifact };
}

/**
 * The transition that ENTERS a chain's first step — the prompt builder
 * the pre-chat page invokes when it starts the first session.
 */
export function entryTransition(chainId: string): StepTransition | null {
  return chainSteps(chainId)[0]?.enter ?? null;
}

/**
 * Outcome CTAs for the step a (skill, chain) resolves to — the
 * registry-owned `start_session` transitions shown on its Session
 * Outcome screen. Each carries its own `buildPrompt`.
 */
export function outcomeTransitions(
  skillId: string | null | undefined,
  chainId?: string,
): StepTransition[] {
  if (skillId == null) return [];
  return resolveStep(skillId, chainId)?.outcomeActions ?? [];
}

// ── Test-only access ────────────────────────────────────────────────
/**
 * Raw flow table — exposed solely for invariant tests. Do NOT import
 * this from app code; use the exported helpers instead.
 *
 * @internal
 */
export const __WIZARD_FLOW_FOR_TESTS: ReadonlyArray<{
  readonly id: string;
  readonly aliases?: ReadonlyArray<string>;
  readonly artifact: string;
  readonly chains: ReadonlyArray<string>;
  readonly hasPreChat: boolean;
  readonly runningLabel: string;
  readonly outcomeLabel: string;
  readonly outcomeTargets: ReadonlyArray<string>;
}> = WIZARD_FLOW.map((s) => ({
  id: s.id,
  aliases: s.aliases,
  artifact: s.artifact,
  chains: s.chains,
  hasPreChat: s.preChat != null,
  runningLabel: s.runningLabel,
  outcomeLabel: s.outcomeLabel,
  outcomeTargets: (s.outcomeActions ?? []).map((a) => a.target),
}));
