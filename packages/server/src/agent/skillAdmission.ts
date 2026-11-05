import { isSkillGroupEnabled, type Project, type SkillDecision } from "@thinkrail/contracts";

export type { SkillDecision };

export interface SkillAdmissionContext {
	trusted: boolean;
	piResourceTrusted: boolean;
	acknowledged: readonly string[];
	disabled: readonly string[];
	disabledGroups: readonly string[];
	enabledGroups: readonly string[];
	otherAgentSkills: boolean;
	overrides: Readonly<Record<string, "on" | "off">>;
}

export function admissionContextFor(
	project:
		| Pick<
				Project,
				| "trusted"
				| "piResourceTrust"
				| "acknowledgedSkills"
				| "disabledSkills"
				| "disabledGroups"
				| "enabledGroups"
		  >
		| undefined,
	overrides: Readonly<Record<string, "on" | "off">> = {},
	otherAgentSkills = false,
): SkillAdmissionContext {
	return {
		trusted: project?.trusted === true,
		piResourceTrusted: project?.piResourceTrust === "granted",
		acknowledged: project?.acknowledgedSkills ?? [],
		disabled: project?.disabledSkills ?? [],
		disabledGroups: project?.disabledGroups ?? [],
		enabledGroups: project?.enabledGroups ?? [],
		otherAgentSkills,
		overrides,
	};
}

export interface SkillFacts {
	name: string;
	isProjectAlias: boolean;
	group: string;
	isPlugin: boolean;
}

export function decideSkill(skill: SkillFacts, ctx: SkillAdmissionContext): SkillDecision {
	if (skill.isProjectAlias) {
		if (!ctx.trusted) return "untrusted";
		if (!ctx.acknowledged.includes(skill.name)) return "pending-ack";
	}
	const override = ctx.overrides[skill.name];
	if (override === "off") return "disabled";
	if (override === "on") return "load";
	if (!isSkillGroupEnabled(ctx, skill.group, ctx.otherAgentSkills)) return "disabled";
	if (skill.isPlugin && !isSkillGroupEnabled(ctx, "@plugins", ctx.otherAgentSkills))
		return "disabled";
	if (ctx.disabled.includes(skill.name)) return "disabled";
	return "load";
}

export function isSkillLoaded(skill: SkillFacts, ctx: SkillAdmissionContext): boolean {
	return decideSkill(skill, ctx) === "load";
}
