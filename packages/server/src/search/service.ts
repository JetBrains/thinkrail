import { open } from "node:fs/promises";
import type {
	Project,
	SearchGroup,
	SearchKind,
	SearchPreviewMessage,
	SearchPreviewResult,
	SearchPreviewTarget,
	SearchQueryResult,
	Workspace,
	WsParams,
} from "@thinkrail/contracts";
import {
	DEFAULT_SEARCH_GROUP_LIMIT,
	MAX_SEARCH_GROUP_LIMIT,
	MAX_SEARCH_QUERY_LENGTH,
	parseMatchTerms,
	SEARCH_KINDS,
} from "@thinkrail/contracts";
import { resolveContainedFile, resourceMeta } from "../fs";
import type { HistorySession } from "../history";
import type { SpecSnapshotEntry } from "../spec";
import type { StoredPlanFile } from "../todos";
import { FileListCache } from "./files";
import { deadlineAt, emptyGroup } from "./hits";
import {
	type ChatLabel,
	type ProviderInput,
	type SearchRoot,
	searchChats,
	searchFiles,
	searchPlans,
	searchSpecs,
	searchWorkspaces,
} from "./providers";

export interface SearchReaders {
	readonly projects: () => Project[];
	readonly workspaces: () => Workspace[];
	readonly sessions: () => Promise<{ sessions: readonly HistorySession[]; indexing: boolean }>;
	readonly specs: (root: string) => readonly SpecSnapshotEntry[];
	readonly plans: (root: string) => StoredPlanFile[];
	readonly invalidateSpecs: (root: string) => void;
	readonly files?: FileListCache;
	readonly now?: () => number;
}

export interface SearchService {
	query(clientKey: string, params: WsParams<"search.query">): Promise<SearchQueryResult>;
	preview(target: SearchPreviewTarget): Promise<SearchPreviewResult>;
	invalidateRoot(root: string): void;
}

export const SEARCH_BUDGET = {
	queryMs: 300,
	providerMs: 120,
	previewBytes: 64 * 1024,
	previewMessages: 7,
	previewMessageChars: 600,
} as const;

function clampLimit(limit: number | undefined): number {
	if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_SEARCH_GROUP_LIMIT;
	return Math.max(1, Math.min(MAX_SEARCH_GROUP_LIMIT, Math.floor(limit)));
}

function isDefaultRecord(workspace: Workspace, project: Project): boolean {
	return workspace.kind === "default" || workspace.worktreePath === project.path;
}

export function resolveSearchRoots(
	projects: readonly Project[],
	workspaces: readonly Workspace[],
	context: { projectId?: string; workspaceId?: string },
): SearchRoot[] {
	const openIds = new Set(projects.map((project) => project.id));
	const current = context.workspaceId
		? workspaces.find((workspace) => workspace.id === context.workspaceId)
		: undefined;
	const roots: SearchRoot[] = [];
	const seen = new Set<string>();
	if (current && openIds.has(current.projectId)) {
		roots.push({
			root: current.worktreePath,
			projectId: current.projectId,
			workspaceId: current.id,
			current: true,
		});
		seen.add(current.worktreePath);
	}
	const ordered = [...projects].sort((a, b) =>
		a.id === context.projectId ? -1 : b.id === context.projectId ? 1 : 0,
	);
	for (const project of ordered) {
		if (seen.has(project.path)) continue;
		const defaultRecord = workspaces.find(
			(workspace) => workspace.projectId === project.id && isDefaultRecord(workspace, project),
		);
		roots.push({
			root: project.path,
			projectId: project.id,
			...(defaultRecord ? { workspaceId: defaultRecord.id } : {}),
			current: !current && project.id === context.projectId,
		});
		seen.add(project.path);
	}
	return roots;
}

export function createSearchService(readers: SearchReaders): SearchService {
	const files = readers.files ?? new FileListCache();
	const now = readers.now ?? (() => performance.now());
	const latestSeq = new Map<string, number>();

	const openWorkspaces = (projects: readonly Project[]) => {
		const open = new Set(projects.map((project) => project.id));
		return readers.workspaces().filter((workspace) => open.has(workspace.projectId));
	};

	const chatLabeler = (workspaces: readonly Workspace[]) => {
		const byPath = new Map<string, ChatLabel>();
		for (const workspace of workspaces) {
			byPath.set(workspace.worktreePath, {
				projectId: workspace.projectId,
				workspaceId: workspace.id,
			});
		}
		return (cwd: string) => byPath.get(cwd) ?? null;
	};

	return {
		async query(clientKey, params) {
			const seq = params.seq;
			const previous = latestSeq.get(clientKey) ?? Number.NEGATIVE_INFINITY;
			if (seq < previous) return { seq, groups: [], superseded: true };
			latestSeq.set(clientKey, seq);
			const superseded = () => latestSeq.get(clientKey) !== seq;

			const terms = parseMatchTerms(params.query.slice(0, MAX_SEARCH_QUERY_LENGTH));
			const kinds = new Set<SearchKind>(params.kinds ?? SEARCH_KINDS);
			if (terms.length === 0) return { seq, groups: [...kinds].map((kind) => emptyGroup(kind)) };

			const limit = clampLimit(params.limit);
			const started = now();
			const input = (): ProviderInput => ({
				terms,
				limit,
				deadline: deadlineAt(
					Math.min(now() + SEARCH_BUDGET.providerMs, started + SEARCH_BUDGET.queryMs),
					now,
				),
			});
			const projects = readers.projects();
			const workspaces = openWorkspaces(projects);
			const roots = resolveSearchRoots(projects, workspaces, params.context);
			const specRoots = roots.filter((root) => root.current);

			const groups: SearchGroup[] = [];
			const push = (kind: SearchKind, run: () => SearchGroup) => {
				if (!kinds.has(kind)) return;
				try {
					groups.push(run());
				} catch {
					groups.push(emptyGroup(kind, "failed"));
				}
			};
			push("workspace", () => searchWorkspaces(workspaces, input()));
			push("file", () => searchFiles(roots, files, input()));
			push("spec", () => searchSpecs(specRoots, readers.specs, input()));

			let sessions: { sessions: readonly HistorySession[]; indexing: boolean } | null = null;
			if (kinds.has("chat") || kinds.has("transcript") || kinds.has("plan")) {
				try {
					sessions = await readers.sessions();
				} catch {
					sessions = null;
				}
			}
			if (superseded()) return { seq, groups: [], superseded: true };
			if (kinds.has("chat") || kinds.has("transcript")) {
				if (!sessions) {
					if (kinds.has("chat")) groups.push(emptyGroup("chat", "failed"));
					if (kinds.has("transcript")) groups.push(emptyGroup("transcript", "failed"));
				} else {
					const result = searchChats(
						sessions.sessions,
						sessions.indexing,
						chatLabeler(workspaces),
						input(),
					);
					if (kinds.has("chat")) groups.push(result.chats);
					if (kinds.has("transcript")) groups.push(result.transcripts);
				}
			}
			push("plan", () =>
				searchPlans(
					workspaces,
					readers.plans,
					sessions ? new Set(sessions.sessions.map((session) => session.sessionId)) : null,
					input(),
				),
			);
			if (superseded()) return { seq, groups: [], superseded: true };
			return { seq, groups };
		},

		async preview(target) {
			const projects = readers.projects();
			const workspaces = openWorkspaces(projects);
			const rootFor = (projectId: string, workspaceId?: string): string | null => {
				if (workspaceId) {
					return workspaces.find((workspace) => workspace.id === workspaceId)?.worktreePath ?? null;
				}
				return projects.find((project) => project.id === projectId)?.path ?? null;
			};
			switch (target.kind) {
				case "chat": {
					const { sessions } = await readers.sessions();
					const session = sessions.find((candidate) => candidate.sessionId === target.sessionId);
					if (!session || !chatLabeler(workspaces)(session.cwd)) {
						return { kind: "unavailable", reason: "missing" };
					}
					return transcriptPreview(session, target.messageIndex);
				}
				case "file": {
					const root = rootFor(target.projectId, target.workspaceId);
					if (!root) return { kind: "unavailable", reason: "missing" };
					return fileHeadPreview(root, target.path);
				}
				case "spec": {
					const root = rootFor(target.projectId, target.workspaceId);
					if (!root) return { kind: "unavailable", reason: "missing" };
					const entry = readers.specs(root).find((candidate) => candidate.path === target.path);
					if (!entry) return { kind: "unavailable", reason: "missing" };
					const truncated = entry.content.length > SEARCH_BUDGET.previewBytes;
					return {
						kind: "text",
						title: entry.title,
						body: truncated ? entry.content.slice(0, SEARCH_BUDGET.previewBytes) : entry.content,
						truncated,
					};
				}
				case "plan": {
					const workspace = workspaces.find((candidate) => candidate.id === target.workspaceId);
					if (!workspace) return { kind: "unavailable", reason: "missing" };
					const file = readers
						.plans(workspace.worktreePath)
						.find((candidate) => candidate.sessionId === target.sessionId);
					if (!file) return { kind: "unavailable", reason: "missing" };
					return { kind: "text", title: "", body: renderPlan(file), truncated: false };
				}
			}
		},

		invalidateRoot(root) {
			files.invalidate(root);
			readers.invalidateSpecs(root);
		},
	};
}

function transcriptPreview(session: HistorySession, messageIndex?: number): SearchPreviewResult {
	const entries = session.entries;
	const focusAt =
		messageIndex === undefined
			? -1
			: entries.findIndex((entry) => entry.messageIndex === messageIndex);
	const half = Math.floor(SEARCH_BUDGET.previewMessages / 2);
	const start = focusAt === -1 ? 0 : Math.max(0, focusAt - half);
	const window = entries.slice(start, start + SEARCH_BUDGET.previewMessages);
	const messages: SearchPreviewMessage[] = window.map((entry) => ({
		role: entry.role,
		messageIndex: entry.messageIndex,
		text:
			entry.text.length > SEARCH_BUDGET.previewMessageChars
				? `${entry.text.slice(0, SEARCH_BUDGET.previewMessageChars)}…`
				: entry.text,
		focus: entry.messageIndex === messageIndex,
	}));
	return {
		kind: "transcript",
		title: session.title ?? "",
		messages,
		truncated: window.length < entries.length,
	};
}

async function fileHeadPreview(root: string, path: string): Promise<SearchPreviewResult> {
	let abs: string;
	try {
		abs = resolveContainedFile(root, path);
	} catch {
		return { kind: "unavailable", reason: "missing" };
	}
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(abs, "r");
	} catch {
		return { kind: "unavailable", reason: "missing" };
	}
	try {
		const stat = await handle.stat();
		if (!stat.isFile()) return { kind: "unavailable", reason: "unsupported" };
		const length = Math.min(stat.size, SEARCH_BUDGET.previewBytes);
		const buffer = new Uint8Array(length);
		const { bytesRead } = await handle.read(buffer, 0, length, 0);
		const bytes = buffer.subarray(0, bytesRead);
		const meta = resourceMeta(bytes, path);
		if (!meta.text) return { kind: "unavailable", reason: "binary" };
		return {
			kind: "text",
			title: path,
			body: new TextDecoder().decode(bytes),
			truncated: stat.size > length,
		};
	} finally {
		await handle.close();
	}
}

function renderPlan(file: StoredPlanFile): string {
	const plan = file.read();
	const mark = (status: string) => (status === "done" ? "x" : status === "in_progress" ? "~" : " ");
	const lines: string[] = [];
	for (const group of plan.groups) {
		lines.push(`## ${group.title}`);
		for (const todo of group.todos) lines.push(`- [${mark(todo.status)}] ${todo.title}`);
		lines.push("");
	}
	if (plan.todos.length > 0) {
		for (const todo of plan.todos) lines.push(`- [${mark(todo.status)}] ${todo.title}`);
	}
	return lines.join("\n").trim();
}
