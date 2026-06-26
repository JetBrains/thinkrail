import type {
  LabeledOption,
  RuntimeCapabilities,
  RuntimeFlag,
} from "@/types/rpc-methods.ts";

/** Flag key for the opt-out 1M-context window (declared by the Claude runtime). */
export const CONTEXT_1M_FLAG = "context1m";

/**
 * Per-model capability filtering for the config pickers.
 *
 * The runtime advertises model-wide menus (`effortLevels`, `flags`) plus a
 * `modelCapabilities` allowlist scoping them per model. These helpers narrow
 * the menus to the selected model so the UI can't offer an unsound combination
 * (e.g. Haiku + `xhigh`, or 1M context on a 200K-only model). A model with no
 * `modelCapabilities` entry (legacy / out-of-caps) is treated as unconstrained
 * — every option stays visible.
 */

function entryFor(caps: RuntimeCapabilities | undefined, model: string) {
  return caps?.modelCapabilities?.find((mc) => mc.model === model) ?? null;
}

/** Display label for `model` from the runtime's model list, falling back to
 *  the raw id when the model isn't in the catalog. */
export function modelLabel(
  caps: RuntimeCapabilities | undefined,
  model: string,
): string {
  return caps?.models?.find((m) => m.value === model)?.label ?? model;
}

/** Effort options to show for `model` — the runtime list filtered to what the
 *  model accepts. `auto` is always present. */
export function effortOptionsForModel(
  caps: RuntimeCapabilities | undefined,
  model: string,
): LabeledOption[] {
  const all = caps?.effortLevels ?? [];
  const entry = entryFor(caps, model);
  if (!entry) return all;
  const allowed = new Set(entry.effortLevels);
  return all.filter((e) => allowed.has(e.value));
}

/** Flags to show for `model` — the runtime flags filtered to what the model
 *  supports (e.g. the 1M-context flag is dropped on 200K-only models). */
export function flagsForModel(
  caps: RuntimeCapabilities | undefined,
  model: string,
): RuntimeFlag[] {
  const all = caps?.flags ?? [];
  const entry = entryFor(caps, model);
  if (!entry) return all;
  const allowed = new Set(entry.flags ?? []);
  return all.filter((f) => allowed.has(f.key));
}

/** Whether `model` accepts the effort value `effort` (`auto`/empty always do). */
export function modelSupportsEffort(
  caps: RuntimeCapabilities | undefined,
  model: string,
  effort: string | null | undefined,
): boolean {
  if (!effort || effort === "auto") return true;
  const entry = entryFor(caps, model);
  if (!entry) return true;
  return entry.effortLevels.includes(effort);
}

/** Whether `model` supports the flag `key` (unconstrained models support all). */
export function modelSupportsFlag(
  caps: RuntimeCapabilities | undefined,
  model: string,
  key: string,
): boolean {
  const entry = entryFor(caps, model);
  if (!entry) return true;
  return (entry.flags ?? []).includes(key);
}

/** Whether the 1M-context window is effectively on given `flags` (the flag's
 *  declared default applies when the key is absent). */
function is1mEffectivelyOn(
  caps: RuntimeCapabilities | undefined,
  flags: Record<string, boolean> | undefined,
): boolean {
  const flag = caps?.flags?.find((f) => f.key === CONTEXT_1M_FLAG);
  if (!flag) return false;
  return flags?.[CONTEXT_1M_FLAG] ?? flag.default;
}

/** What changes if the session switches to `model`, given its current effort
 *  and flags. Drives the confirm-and-clamp prompt and the clamped values to
 *  apply. */
export interface ModelSwitchPlan {
  /** Effort to apply after the switch — the current one, or `auto` if the new
   *  model doesn't accept it. */
  clampedEffort: string;
  /** The current effort had to be dropped to `auto`. */
  effortReset: boolean;
  /** The new model lacks the 1M window while it's currently on — context will
   *  fall back to 200K. Informational only: the model ignores the 1M beta, so
   *  this never crashes and doesn't require a restart. */
  contextCapped: boolean;
  /** Whether the switch needs a confirm + restart. Driven by `effortReset`
   *  only: there's no live `set_effort`, so changing effort means relaunching
   *  the SDK client — and an unsupported effort would otherwise crash the next
   *  turn. A model switch on its own (and the harmless 1M→200K fallback) is an
   *  instant live `set_model`, so it must NOT gate on `contextCapped`. */
  hasConflict: boolean;
}

export function planModelSwitch(
  caps: RuntimeCapabilities | undefined,
  model: string,
  currentEffort: string | null | undefined,
  currentFlags: Record<string, boolean> | undefined,
): ModelSwitchPlan {
  const effortOk = modelSupportsEffort(caps, model, currentEffort);
  const contextCapped =
    is1mEffectivelyOn(caps, currentFlags) &&
    !modelSupportsFlag(caps, model, CONTEXT_1M_FLAG);
  const effortReset = !effortOk && !!currentEffort && currentEffort !== "auto";
  return {
    clampedEffort: effortOk ? currentEffort || "auto" : "auto",
    effortReset,
    contextCapped,
    hasConflict: effortReset,
  };
}

/** Content for the model-switch confirm dialog, derived from a {@link ModelSwitchPlan}.
 *
 *  Both a live switch and a restart discard the *model-scoped* prompt cache, so
 *  every switch carries a one-time cost warning — the next turn reprocesses the
 *  conversation so far at the new model's rate. The restart path (effort/1M
 *  conflict) is the heavier one. */
export interface ModelSwitchPrompt {
  /** Confirming restarts the session (effort/1M conflict) instead of switching live. */
  needsRestart: boolean;
  /** Confirm-button label. */
  confirmLabel: string;
  /** Consequence bullets to list (effort reset, 1M→200K cap); may be empty. */
  consequences: string[];
  /** One-line prompt-cache cost warning, tailored to the live vs restart path. */
  costNote: string;
}

export function describeModelSwitch(
  plan: ModelSwitchPlan,
  modelName: string,
): ModelSwitchPrompt {
  const consequences: string[] = [];
  if (plan.effortReset) {
    consequences.push(
      "Effort resets to auto — the new model doesn't support the current level.",
    );
  }
  if (plan.contextCapped) {
    consequences.push(
      "Context window falls back to 200K (the new model has no 1M window).",
    );
  }
  const tail = `the next turn reprocesses the conversation so far at ${modelName}'s rate — a one-time cost.`;
  const costNote = plan.hasConflict
    ? `Restarting clears the prompt cache, so ${tail}`
    : `The switch is instant, but it clears the prompt cache: ${tail}`;
  return {
    needsRestart: plan.hasConflict,
    confirmLabel: plan.hasConflict ? "Switch & restart" : "Switch",
    consequences,
    costNote,
  };
}
