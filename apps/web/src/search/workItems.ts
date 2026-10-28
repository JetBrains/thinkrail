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
	isDefaultWorkspace,
	type SessionAttention,
	type SwitcherSession,
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
		items.push({
			id: `project:${project.id}`,
			kind: "project",
			title: project.name,
			subtitle: project.path,
			group: "projects",
			scope: "work",
			icon: RiFolderLine,
			projectId: project.id,
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
	for (const [workspaceId, records] of Object.entries(state.sessionStateByWorkspace)) {
		const workspace = workspaceById.get(workspaceId);
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
			const where = workspace
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
				projectId: record.projectId,
				workspaceId,
				sessionId: record.sessionId,
				contextBoost: contextBoost(record.projectId, workspaceId, input),
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
	for (const workspace of workspaceById.values()) {
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
			keywords: reviewRef ? [reviewRef] : [],
			hostFields: [
				{ key: "title", text: workspace.name },
				{ key: "subtitle", text: workspace.branch, secondary: true },
				...(reviewRef ? [{ key: "keywords", text: reviewRef, secondary: true }] : []),
			],
			group: "workspaces",
			scope: "work",
			icon: isDefault ? RiHome4Line : RiGitBranchLine,
			...(attention ? { attention } : {}),
			...(reviewRef ? { badge: reviewRef } : {}),
			projectId: workspace.projectId,
			workspaceId: workspace.id,
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

export function waitingItems(
	sessions: readonly SwitcherSession[],
	items: readonly PaletteItem[],
): PaletteItem[] {
	const byId = new Map(items.map((item) => [item.id, item]));
	return sessions.flatMap((session) =>
		session.attention === "running" ? [] : (byId.get(`chat:${session.sessionId}`) ?? []),
	);
}
