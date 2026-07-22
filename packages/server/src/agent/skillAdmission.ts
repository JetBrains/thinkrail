// The pure decision layer for which skills a session actually loads. Kept free of pi/fs so it can be
// exhaustively unit-tested: given a skill's facts and the resolved admission context (project trust +
// acknowledged set + project-baseline disables + per-workspace overrides), it returns one verdict.
//
// Scope recap (see agent/SPEC.md): trust is per-project, availability is per-worktree, per-skill toggles
// layer a per-workspace override over a per-project baseline. Committed **project-scoped aliases**
// (.claude/skills etc.) are the gated class — attacker-controlled for a clone; personal / bundled /
// pi-native skills are never gated by trust, only by the enable/disable toggles.

/** The resolved inputs for one workspace's session (project fields + that workspace's overrides). */
export interface SkillAdmissionContext {
	/** Project engaged trust — the gate on any project-scoped alias. */
	trusted: boolean;
	/** Project-scoped alias skill names the user has acknowledged (see `Project.acknowledgedSkills`). */
	acknowledged: readonly string[];
	/** Project-baseline disabled skill names, any source (`Project.disabledSkills`). */
	disabled: readonly string[];
	/** Per-workspace overrides by skill name (`Workspace.skillOverrides`). */
	overrides: Readonly<Record<string, "on" | "off">>;
}

/** One skill reduced to just what the decision needs — decoupled from pi's `Skill` for testability. */
export interface SkillFacts {
	name: string;
	/** True for a committed project-scoped alias (the trust-gated class); false for personal/bundled/pi. */
	isProjectAlias: boolean;
}

/**
 * Why a skill is or isn't loaded — the UI renders all four so a hidden skill is never a silent mystery:
 * - `load` — in the agent's context / invocable.
 * - `untrusted` — a project alias, but the project isn't trusted yet (grant trust to consider it).
 * - `pending-ack` — a project alias under a trusted project that appeared *after* trust was granted
 *   (a pull / branch switch); needs a one-tap confirm before it loads.
 * - `disabled` — admissible but turned off (workspace override, else project baseline).
 */
export type SkillDecision = "load" | "untrusted" | "pending-ack" | "disabled";

/**
 * The single source of truth for admission. Order matters: the **trust gate is checked first** for a
 * project alias (so an "on" override can never un-gate an untrusted or unacknowledged repo skill), then
 * the enable/disable layer (workspace override wins over project baseline).
 */
export function decideSkill(skill: SkillFacts, ctx: SkillAdmissionContext): SkillDecision {
	if (skill.isProjectAlias) {
		if (!ctx.trusted) return "untrusted";
		if (!ctx.acknowledged.includes(skill.name)) return "pending-ack";
	}
	const override = ctx.overrides[skill.name];
	if (override === "off") return "disabled";
	if (override === "on") return "load";
	if (ctx.disabled.includes(skill.name)) return "disabled";
	return "load";
}

/** Convenience: is this skill in the agent's loaded set? */
export function isSkillLoaded(skill: SkillFacts, ctx: SkillAdmissionContext): boolean {
	return decideSkill(skill, ctx) === "load";
}
