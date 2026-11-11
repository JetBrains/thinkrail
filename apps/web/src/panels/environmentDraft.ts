import type {
	HostEnvironment,
	HostEnvironmentIssue,
	HostEnvironmentStatus,
} from "@thinkrail/contracts";
import { randomId } from "@/lib";

export interface EnvironmentDraftVar {
	id: string;
	name: string;
	value: string;
}

export interface EnvironmentDraft {
	agentDir: string;
	vars: EnvironmentDraftVar[];
}

export type EnvironmentIssueCode = HostEnvironmentIssue["code"];

export interface EnvironmentDraftIssues {
	agentDir?: EnvironmentIssueCode;
	vars: Record<string, EnvironmentIssueCode>;
}

export const NO_ISSUES: EnvironmentDraftIssues = { vars: {} };

export function draftFromEnvironment(environment: HostEnvironment): EnvironmentDraft {
	return {
		agentDir: environment.agentDir ?? "",
		vars: environment.vars.map(({ name, value }) => ({ id: randomId("env"), name, value })),
	};
}

function filledVars(draft: EnvironmentDraft): EnvironmentDraftVar[] {
	return draft.vars.filter((entry) => entry.name.trim() !== "" || entry.value !== "");
}

export function environmentFromDraft(draft: EnvironmentDraft): HostEnvironment {
	const agentDir = draft.agentDir.trim();
	return {
		...(agentDir ? { agentDir } : {}),
		vars: filledVars(draft).map(({ name, value }) => ({ name: name.trim(), value })),
	};
}

export function draftIssues(
	draft: EnvironmentDraft,
	issues: readonly HostEnvironmentIssue[],
): EnvironmentDraftIssues {
	const sent = filledVars(draft);
	const result: EnvironmentDraftIssues = { vars: {} };
	for (const issue of issues) {
		if (issue.field === "agentDir") result.agentDir = issue.code;
		else {
			const row = sent[issue.index];
			if (row) result.vars[row.id] = issue.code;
		}
	}
	return result;
}

export function draftChanged(draft: EnvironmentDraft, status: HostEnvironmentStatus): boolean {
	const next = environmentFromDraft(draft);
	const stored = status.stored;
	return (
		next.agentDir !== stored.agentDir ||
		next.vars.length !== stored.vars.length ||
		next.vars.some(
			(entry, index) =>
				entry.name !== stored.vars[index]?.name || entry.value !== stored.vars[index]?.value,
		)
	);
}
