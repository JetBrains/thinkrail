import type { SkillDecision } from "@thinkrail/contracts";

export type { SkillDecision };

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
	/**
	 * Project-baseline disabled **group** keys (`Project.disabledGroups`) — a group key is a plugin name or
	 * a source tier (`project`/`personal`/`bundled`/`pi`), plus the special `@plugins` (all plugin skills).
	 * Turns a whole plugin/source off in one toggle, and keeps *future* skills in that group off too.
	 */
	disabledGroups: readonly string[];
	/** Per-workspace overrides by skill name (`Workspace.skillOverrides`). */
	overrides: Readonly<Record<string, "on" | "off">>;
}

/** One skill reduced to just what the decision needs — decoupled from pi's `Skill` for testability. */
export interface SkillFacts {
	name: string;
	/** True for a committed project-scoped alias (the trust-gated class); false for personal/bundled/pi. */
	isProjectAlias: boolean;
	/** The group key this skill toggles under (plugin name, or `project`/`personal`/`bundled`/`pi`). */
	group: string;
	/** Whether it belongs to a Claude plugin — subject to the `@plugins` super-toggle. */
	isPlugin: boolean;
}

/**
 * The single source of truth for admission. Precedence, most-specific first: the **trust gate** for a
 * project alias (so an "on" override can never un-gate an untrusted/unacknowledged repo skill) → the
 * per-skill **workspace override** (an explicit `on` beats a group disable; `off` always wins) → the
 * project-baseline **group** disable (the skill's own group, or `@plugins` for any plugin skill) → the
 * project-baseline **per-skill** disable → load.
 */
export function decideSkill(skill: SkillFacts, ctx: SkillAdmissionContext): SkillDecision {
	if (skill.isProjectAlias) {
		if (!ctx.trusted) return "untrusted";
		if (!ctx.acknowledged.includes(skill.name)) return "pending-ack";
	}
	const override = ctx.overrides[skill.name];
	if (override === "off") return "disabled";
	if (override === "on") return "load";
	if (ctx.disabledGroups.includes(skill.group)) return "disabled";
	if (skill.isPlugin && ctx.disabledGroups.includes("@plugins")) return "disabled";
	if (ctx.disabled.includes(skill.name)) return "disabled";
	return "load";
}

/** Convenience: is this skill in the agent's loaded set? */
export function isSkillLoaded(skill: SkillFacts, ctx: SkillAdmissionContext): boolean {
	return decideSkill(skill, ctx) === "load";
}
