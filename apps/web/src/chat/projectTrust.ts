import type {
	Project,
	ProjectResourceKind,
	ProjectTrustSummary,
	WsParams,
} from "@thinkrail/contracts";

export type ProjectTrustNotice =
	| { kind: "hidden" }
	| {
			kind: "untrusted";
			aliasSkills: number;
			piResources: ProjectResourceKind[];
			mcpServers: number;
	  }
	| { kind: "unacknowledged"; names: string[] }
	| { kind: "trusted"; aliasSkills: number };

type TrustRecord = Pick<Project, "trusted" | "piResourceTrust" | "acknowledgedSkills">;

export function deriveProjectTrustNotice(
	project: TrustRecord | undefined,
	summary: ProjectTrustSummary | null,
): ProjectTrustNotice {
	if (!project || !summary) return { kind: "hidden" };
	const mcpServers = summary.mcpServers ?? 0;
	const aliasPending = summary.aliasSkills.length > 0 && project.trusted !== true;
	const nativePending =
		(summary.piResources.length > 0 || mcpServers > 0) && project.piResourceTrust !== "granted";
	if (aliasPending || nativePending) {
		return {
			kind: "untrusted",
			aliasSkills: aliasPending ? summary.aliasSkills.length : 0,
			piResources: nativePending ? summary.piResources : [],
			mcpServers: nativePending ? mcpServers : 0,
		};
	}
	if (summary.aliasSkills.length === 0 && summary.piResources.length === 0 && mcpServers === 0)
		return { kind: "hidden" };
	const acknowledged = new Set(project.acknowledgedSkills ?? []);
	const names = summary.aliasSkills.filter((name) => !acknowledged.has(name));
	if (names.length > 0) return { kind: "unacknowledged", names };
	return { kind: "trusted", aliasSkills: summary.aliasSkills.length };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

const LOADED_KINDS: ReadonlyArray<[ProjectResourceKind, string]> = [
	["skills", "skills"],
	["prompts", "prompts"],
	["themes", "themes"],
	["systemPrompt", "system prompt"],
	["subagents", "subagent definitions"],
];
const CODE_KINDS: ReadonlyArray<[ProjectResourceKind, string]> = [
	["extensions", "extensions"],
	["settings", "settings"],
];

function namesOf(
	kinds: ReadonlyArray<[ProjectResourceKind, string]>,
	present: ReadonlySet<ProjectResourceKind>,
): string {
	const words = kinds.filter(([kind]) => present.has(kind)).map(([, word]) => word);
	return words.length < 2
		? (words[0] ?? "")
		: `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

export function untrustedNoticeText(
	notice: Extract<ProjectTrustNotice, { kind: "untrusted" }>,
): string {
	const parts = [
		...(notice.aliasSkills > 0 ? [plural(notice.aliasSkills, "skill")] : []),
		...(notice.piResources.length > 0 ? ["its own Pi resources"] : []),
		...(notice.mcpServers > 0 ? [plural(notice.mcpServers, "MCP server")] : []),
	];
	return `This project ships ${parts.join(" and ")} — off until you trust it.`;
}

export function trustEnablesText(
	notice: Extract<ProjectTrustNotice, { kind: "untrusted" }>,
): string | null {
	const present = new Set(notice.piResources);
	const loads = namesOf(LOADED_KINDS, present);
	const runs = namesOf(CODE_KINDS, present);
	const code = `${runs} run code on this machine`;
	const enables = !runs
		? loads
			? `Trust loads its ${loads}.`
			: null
		: loads
			? `Trust loads its ${loads}, and lets its ${code}.`
			: `Trust lets its ${code}.`;
	if (notice.mcpServers === 0) return enables;
	const mcp = `Trust alone does not start its ${plural(notice.mcpServers, "MCP server")}.`;
	return enables ? `${enables} ${mcp}` : mcp;
}

export function trustGrantParams(
	projectId: string,
	notice: Extract<ProjectTrustNotice, { kind: "untrusted" }>,
): WsParams<"project.setTrust"> {
	return {
		id: projectId,
		trusted: true,
		...(notice.piResources.length > 0 || notice.mcpServers > 0 ? { resources: true } : {}),
	};
}

export function trustedNoticeText(
	notice: Extract<ProjectTrustNotice, { kind: "trusted" }>,
): string {
	return notice.aliasSkills > 0
		? `${plural(notice.aliasSkills, "project skill")} trusted.`
		: "Project resources trusted.";
}

export function canStopTrusting(project: TrustRecord | undefined): boolean {
	return project?.trusted === true || project?.piResourceTrust === "granted";
}

export function stopTrustingText(
	project: TrustRecord | undefined,
	supportsProjectTrust: boolean,
): string {
	return supportsProjectTrust && project?.piResourceTrust === "granted"
		? "Its project skills, Pi resources and MCP servers stop loading; running subagents stop and open chats reload when idle."
		: "Its project skills stop loading in new chats.";
}
