import type {
	Project,
	ProjectResourceKind,
	ProjectTrustSummary,
	WsParams,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";

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

const LOADED_KINDS: ReadonlyArray<[ProjectResourceKind, MessageKey]> = [
	["skills", "chat.trust.kind.skills"],
	["prompts", "chat.trust.kind.prompts"],
	["themes", "chat.trust.kind.themes"],
	["systemPrompt", "chat.trust.kind.systemPrompt"],
	["subagents", "chat.trust.kind.subagents"],
];
const CODE_KINDS: ReadonlyArray<[ProjectResourceKind, MessageKey]> = [
	["extensions", "chat.trust.kind.extensions"],
	["settings", "chat.trust.kind.settings"],
];

function namesOf(
	t: Translator,
	kinds: ReadonlyArray<[ProjectResourceKind, MessageKey]>,
	present: ReadonlySet<ProjectResourceKind>,
): string {
	const words = kinds.filter(([kind]) => present.has(kind)).map(([, word]) => t(word));
	const last = words.at(-1);
	return words.length < 2 || last === undefined
		? (words[0] ?? "")
		: t("chat.trust.list.and", {
				head: words.slice(0, -1).join(t("chat.trust.list.separator")),
				last,
			});
}

export function untrustedNoticeText(
	t: Translator,
	notice: Extract<ProjectTrustNotice, { kind: "untrusted" }>,
): string {
	const parts = [
		...(notice.aliasSkills > 0 ? [t("chat.trust.skills", { count: notice.aliasSkills })] : []),
		...(notice.piResources.length > 0 ? [t("chat.trust.piResources")] : []),
		...(notice.mcpServers > 0 ? [t("chat.trust.mcpServers", { count: notice.mcpServers })] : []),
	];
	const items = parts.reduce(
		(head, last) => (head ? t("chat.trust.list.and", { head, last }) : last),
		"",
	);
	return t("chat.trust.untrustedNotice", { items });
}

export function trustEnablesText(
	t: Translator,
	notice: Extract<ProjectTrustNotice, { kind: "untrusted" }>,
): string | null {
	const present = new Set(notice.piResources);
	const loads = namesOf(t, LOADED_KINDS, present);
	const runs = namesOf(t, CODE_KINDS, present);
	const enables = !runs
		? loads
			? t("chat.trust.enablesLoads", { loads })
			: null
		: loads
			? t("chat.trust.enablesLoadsAndRuns", { loads, runs })
			: t("chat.trust.enablesRuns", { runs });
	if (notice.mcpServers === 0) return enables;
	const mcp = t("chat.trust.mcpApproval", { count: notice.mcpServers });
	return enables ? t("chat.trust.sentences", { first: enables, second: mcp }) : mcp;
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
	t: Translator,
	notice: Extract<ProjectTrustNotice, { kind: "trusted" }>,
): string {
	return notice.aliasSkills > 0
		? t("chat.trust.projectSkillsTrusted", { count: notice.aliasSkills })
		: t("chat.trust.resourcesTrusted");
}

export function canStopTrusting(project: TrustRecord | undefined): boolean {
	return project?.trusted === true || project?.piResourceTrust === "granted";
}

export function stopTrustingText(
	t: Translator,
	project: TrustRecord | undefined,
	supportsProjectTrust: boolean,
): string {
	return supportsProjectTrust && project?.piResourceTrust === "granted"
		? t("chat.trust.stopTrustingResources")
		: t("chat.trust.stopTrustingSkills");
}
