import {
	RiChat2Line,
	RiFolderLine,
	RiGitBranchLine,
	RiHome4Line,
	RiLoader4Line,
} from "@remixicon/react";
import type { BranchReviewState, Workspace } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import { chatLabel } from "../lib";
import {
	getSessionAttention,
	isChatsContainer,
	isChatWorkspace,
	isDefaultWorkspace,
	type SessionAttention,
	selectKnownChatTitle,
	type useAppStore,
	workspaceName,
} from "../store";
import type { PaletteItem } from "./model";

type AppState = ReturnType<typeof useAppStore.getState>;

export type WorkItemsState = Pick<
	AppState,
	| "projects"
	| "workspaces"
	| "sessionStateByWorkspace"
	| "layoutDocumentsByWorkspace"
	| "closedChatsByWorkspace"
	| "activeWorkspaceId"
>;

export interface WorkItemsInput {
	t: Translator;
	state: WorkItemsState;
	contextProjectId: string | null;
	firstPrompts: Readonly<Record<string, string>>;
	transcriptPreviews: boolean;
	navigateToProject: (projectId: string) => void;
	navigateToWorkspace: (workspace: Pick<Workspace, "id" | "projectId">, sessionId?: string) => void;
}

const CONTEXT_PROJECT_BOOST = 30;
const CONTEXT_WORKSPACE_BOOST = 15;

const ATTENTION_RANK: Record<SessionAttention, number> = {
	"needs-input": 0,
	error: 1,
	unread: 2,
	running: 3,
};

function strongest(
	current: SessionAttention | undefined,
	next: SessionAttention | null,
): SessionAttention | undefined {
	if (!next) return current;
	if (!current) return next;
	return ATTENTION_RANK[next] < ATTENTION_RANK[current] ? next : current;
}

function contextBoost(
	projectId: string,
	workspaceId: string | null,
	input: WorkItemsInput,
): number {
	return (
		(projectId === input.contextProjectId ? CONTEXT_PROJECT_BOOST : 0) +
		(workspaceId !== null && workspaceId === input.state.activeWorkspaceId
			? CONTEXT_WORKSPACE_BOOST
			: 0)
	);
}

interface Placement {
	readonly activeAt: number;
	readonly project: number;
	readonly workspace: number;
}

function placements(state: WorkItemsState): {
	workspace: ReadonlyMap<string, Placement>;
	project: ReadonlyMap<string, number>;
} {
	const projectRank = new Map<string, number>();
	for (const project of state.projects.filter(isChatsContainer)) {
		projectRank.set(project.id, projectRank.size);
	}
	for (const project of state.projects) {
		if (!isChatsContainer(project)) projectRank.set(project.id, projectRank.size);
	}
	const workspace = new Map<string, Placement>();
	for (const [projectId, rank] of projectRank) {
		const rows = state.workspaces[projectId] ?? [];
		rows.forEach((row, index) => {
			workspace.set(row.id, {
				activeAt: row.lastActiveAt ?? 0,
				project: rank,
				workspace: isDefaultWorkspace(row) ? -1 : rows.length - index,
			});
		});
	}
	return { workspace, project: projectRank };
}

function byFreshness(a: Placement, b: Placement): number {
	return b.activeAt - a.activeAt || a.project - b.project || a.workspace - b.workspace;
}

const REVIEW_STATE_LABELS: Record<BranchReviewState, MessageKey> = {
	open: "search.preview.reviewOpen",
	merged: "search.preview.reviewMerged",
	closed: "search.preview.reviewClosed",
};

export function buildWorkItems(input: WorkItemsInput): PaletteItem[] {
	const { t, state } = input;
	const items: PaletteItem[] = [];
	const projectNames = new Map(state.projects.map((project) => [project.id, project.name]));
	for (const project of state.projects) {
		if (isChatsContainer(project)) continue;
		items.push({
			id: `project:${project.id}`,
			kind: "project",
			title: project.name,
			subtitle: project.path,
			group: "projects",
			scope: "work",
			icon: RiFolderLine,
			contextBoost: project.id === input.contextProjectId ? CONTEXT_PROJECT_BOOST : 0,
			run: () => input.navigateToProject(project.id),
			preview: () => ({
				title: project.name,
				subtitle: project.path,
				fields: [
					[t("search.preview.workspaces"), String(state.workspaces[project.id]?.length ?? 0)],
				],
			}),
		});
	}
	const workspaceById = new Map<string, Workspace>();
	for (const project of state.projects) {
		for (const workspace of state.workspaces[project.id] ?? []) {
			workspaceById.set(workspace.id, workspace);
		}
	}
	const attentionByWorkspace = new Map<string, SessionAttention>();
	const placed = placements(state);
	const placementOf = (workspaceId: string, projectId: string | undefined): Placement =>
		placed.workspace.get(workspaceId) ?? {
			activeAt: 0,
			project: placed.project.get(projectId ?? "") ?? state.projects.length,
			workspace: Number.POSITIVE_INFINITY,
		};
	const recordsPlacement = (
		workspaceId: string,
		records: Readonly<Record<string, { projectId: string }>>,
	) => placementOf(workspaceId, Object.values(records)[0]?.projectId);
	const byFreshest = Object.entries(state.sessionStateByWorkspace).sort(([idA, a], [idB, b]) =>
		byFreshness(recordsPlacement(idA, a), recordsPlacement(idB, b)),
	);
	for (const [workspaceId, records] of byFreshest) {
		const workspace = workspaceById.get(workspaceId);
		if (workspace?.deletionPending === true) continue;
		let attention: SessionAttention | undefined;
		for (const record of Object.values(records)) {
			const recordAttention = getSessionAttention(record.state);
			attention = strongest(attention, recordAttention);
			const knownTitle = selectKnownChatTitle(state, workspaceId, record.sessionId);
			const firstPrompt = input.firstPrompts[record.sessionId];
			if (!knownTitle && !firstPrompt && !recordAttention) continue;
			const projectName = projectNames.get(record.projectId);
			if (projectName === undefined) continue;
			const label = chatLabel(t, knownTitle, firstPrompt);
			const title = label.text;
			const where =
				workspace && !isChatWorkspace(workspace)
					? t("search.item.inWorkspace", {
							project: projectName,
							workspace: workspaceName(t, workspace),
						})
					: projectName;
			items.push({
				id: `chat:${record.sessionId}`,
				kind: "chat",
				title,
				titleSource: label.source,
				...(label.tooltip ? { titleTooltip: label.tooltip, keywords: [label.tooltip] } : {}),
				subtitle: where,
				group: "chats",
				scope: "work",
				icon: recordAttention === "running" ? RiLoader4Line : RiChat2Line,
				running: recordAttention === "running",
				...(recordAttention ? { attention: recordAttention } : {}),
				contextBoost: contextBoost(record.projectId, workspaceId, input),
				...(input.transcriptPreviews
					? { previewTarget: { kind: "chat", sessionId: record.sessionId } }
					: {}),
				run: () =>
					input.navigateToWorkspace(
						{ id: workspaceId, projectId: record.projectId },
						record.sessionId,
					),
				preview: () => ({
					title,
					subtitle: where,
					fields: recordAttention
						? [[t("search.preview.state"), attentionLabel(t, recordAttention)]]
						: [],
				}),
			});
		}
		if (attention) attentionByWorkspace.set(workspaceId, attention);
	}
	const freshestWorkspaces = [...workspaceById.values()].sort((a, b) =>
		byFreshness(placementOf(a.id, a.projectId), placementOf(b.id, b.projectId)),
	);
	for (const workspace of freshestWorkspaces) {
		if (isChatWorkspace(workspace)) continue;
		const projectName = projectNames.get(workspace.projectId) ?? "";
		const review = workspace.review;
		const attention = attentionByWorkspace.get(workspace.id);
		const isDefault = isDefaultWorkspace(workspace);
		const name = workspaceName(t, workspace);
		const reviewRef = review ? `#${review.number}` : null;
		items.push({
			id: `workspace:${workspace.id}`,
			kind: "workspace",
			title: name,
			subtitle: isDefault
				? t("search.item.projectFolder", { project: projectName })
				: `${projectName} · ${workspace.branch}`,
			keywords: [
				...(reviewRef ? [reviewRef] : []),
				...(isDefault && workspace.branch ? [workspace.branch] : []),
			],
			group: "workspaces",
			scope: "work",
			icon: isDefault ? RiHome4Line : RiGitBranchLine,
			...(attention ? { attention } : {}),
			...(reviewRef ? { badge: reviewRef } : {}),
			contextBoost: contextBoost(workspace.projectId, workspace.id, input),
			run: () => input.navigateToWorkspace(workspace),
			preview: () => ({
				title: name,
				subtitle: projectName,
				fields: [
					...(isDefault ? [] : ([[t("search.preview.branch"), workspace.branch]] as const)),
					...(isDefault ? [] : ([[t("search.preview.from"), workspace.baseBranch]] as const)),
					...(review && reviewRef
						? ([
								[
									t("search.preview.review"),
									t(REVIEW_STATE_LABELS[review.state ?? "open"], { ref: reviewRef }),
								],
							] as const)
						: []),
					...(attention
						? ([[t("search.preview.state"), attentionLabel(t, attention)]] as const)
						: []),
				],
			}),
		});
	}
	return items;
}

const ATTENTION_LABELS: Record<SessionAttention, MessageKey> = {
	"needs-input": "search.attention.needsInput",
	error: "search.attention.error",
	unread: "search.attention.unread",
	running: "search.attention.running",
};

export function attentionLabel(t: Translator, attention: SessionAttention): string {
	return t(ATTENTION_LABELS[attention]);
}

export function waitingItems(items: readonly PaletteItem[]): PaletteItem[] {
	return items
		.filter((item) => item.kind === "chat" && item.attention && item.attention !== "running")
		.sort(
			(a, b) => ATTENTION_RANK[a.attention ?? "running"] - ATTENTION_RANK[b.attention ?? "running"],
		);
}
