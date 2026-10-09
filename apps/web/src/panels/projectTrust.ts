import type { Project, ProjectTrustSummary, WsParams } from "@thinkrail/contracts";

export type ProjectTrustNotice =
	| { kind: "hidden" }
	| { kind: "untrusted"; aliasSkills: number; nativeResources: boolean; mcpServers: number }
	| { kind: "unacknowledged"; names: string[] }
	| { kind: "trusted"; aliasSkills: number };

type TrustRecord = Pick<Project, "trusted" | "piResourceTrust" | "acknowledgedSkills">;

export function deriveProjectTrustNotice(
	project: TrustRecord | undefined,
	summary: ProjectTrustSummary | null,
): ProjectTrustNotice {
	if (!project || !summary) return { kind: "hidden" };
	const aliasPending = summary.aliasSkills.length > 0 && project.trusted !== true;
	const nativePending = summary.nativeResources && project.piResourceTrust !== "granted";
	if (aliasPending || nativePending) {
		return {
			kind: "untrusted",
			aliasSkills: aliasPending ? summary.aliasSkills.length : 0,
			nativeResources: nativePending,
			mcpServers: nativePending ? summary.mcpServers : 0,
		};
	}
	if (summary.aliasSkills.length === 0 && !summary.nativeResources) return { kind: "hidden" };
	const acknowledged = new Set(project.acknowledgedSkills ?? []);
	const names = summary.aliasSkills.filter((name) => !acknowledged.has(name));
	if (names.length > 0) return { kind: "unacknowledged", names };
	return { kind: "trusted", aliasSkills: summary.aliasSkills.length };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

export function untrustedNoticeText(
	notice: Extract<ProjectTrustNotice, { kind: "untrusted" }>,
): string {
	const parts = [
		...(notice.aliasSkills > 0 ? [plural(notice.aliasSkills, "skill")] : []),
		...(notice.nativeResources ? ["its own pi resources"] : []),
	];
	return `This project ships ${parts.join(" and ")} — off until you trust it.`;
}

export function trustEnablesText(
	notice: Extract<ProjectTrustNotice, { kind: "untrusted" }>,
): string | null {
	if (!notice.nativeResources) return null;
	const mcp =
		notice.mcpServers > 0
			? ` Its ${plural(notice.mcpServers, "MCP server")} still need${notice.mcpServers === 1 ? "s" : ""} your approval one by one.`
			: "";
	return `Trust loads its skills, prompts, themes, SYSTEM.md and subagent definitions, and lets its extensions and settings run code on this machine.${mcp}`;
}

export function trustGrantParams(
	projectId: string,
	notice: Extract<ProjectTrustNotice, { kind: "untrusted" }>,
): WsParams<"project.setTrust"> {
	return { id: projectId, trusted: true, ...(notice.nativeResources ? { resources: true } : {}) };
}

export function trustedNoticeText(
	notice: Extract<ProjectTrustNotice, { kind: "trusted" }>,
): string {
	return notice.aliasSkills > 0
		? `${plural(notice.aliasSkills, "project skill")} trusted.`
		: "Project resources trusted.";
}

export function stopTrustingText(
	project: TrustRecord | undefined,
	supportsProjectTrust: boolean,
): string {
	return supportsProjectTrust && project?.piResourceTrust === "granted"
		? "Its project skills, pi resources and MCP servers stop loading; running subagents stop and open chats reload when idle."
		: "Its project skills stop loading in new chats.";
}
