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
import type { HistorySession } from "../history";
import { logger } from "../log";
import type { SpecSnapshot } from "../spec";
import type { StoredPlanFile } from "../todos";
import { FileListCache } from "./files";
import { deadlineAt, emptyGroup } from "./hits";
import {
	type ChatLabel,
	type ProviderInput,
	type SearchRoot,
	searchChatTitles,
	searchFiles,
	searchPlans,
	searchSpecs,
	searchTranscripts,
	searchWorkspaces,
} from "./providers";

const log = logger("search");

export interface SearchReaders {
	readonly projects: () => Project[];
	readonly workspaces: () => Workspace[];
	readonly sessions: () => Promise<{ sessions: readonly HistorySession[]; indexing: boolean }>;
	readonly specs: (root: string) => SpecSnapshot;
	readonly plans: (root: string) => StoredPlanFile[];
	readonly invalidateSpecs: (root: string) => void;
	readonly files?: FileListCache;
	readonly now?: () => number;
}

export interface SearchService {
	query(clientKey: string, params: WsParams<"search.query">): Promise<SearchQueryResult>;
	preview(target: SearchPreviewTarget): Promise<SearchPreviewResult>;
	invalidateRoot(root: string): void;
	forgetClient(clientKey: string): void;
}

export const SEARCH_BUDGET = {
	queryMs: 300,
	providerMs: 120,
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

export function resolveSearchRoot(
	projects: readonly Project[],
	workspaces: readonly Workspace[],
	context: { projectId?: string; workspaceId?: string },
): SearchRoot | null {
	const openIds = new Set(projects.map((project) => project.id));
	const current = context.workspaceId
		? workspaces.find((workspace) => workspace.id === context.workspaceId)
		: undefined;
	if (current && openIds.has(current.projectId)) {
		return { root: current.worktreePath, projectId: current.projectId, workspaceId: current.id };
	}
	const project = projects.find((candidate) => candidate.id === context.projectId);
	if (!project) return null;
	const defaultRecord = workspaces.find(
		(workspace) => workspace.projectId === project.id && isDefaultRecord(workspace, project),
	);
	if (!defaultRecord) return null;
	return { root: project.path, projectId: project.id, workspaceId: defaultRecord.id };
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
			const root = resolveSearchRoot(projects, workspaces, params.context);

			const groups: SearchGroup[] = [];
			const push = (kind: SearchKind, run: () => SearchGroup) => {
				if (!kinds.has(kind)) return;
				try {
					groups.push(run());
				} catch (error) {
					log.warn(`search provider failed (${kind})`, error);
					groups.push(emptyGroup(kind, "failed"));
				}
			};
			push("workspace", () => searchWorkspaces(workspaces, input()));
			push("file", () => (root ? searchFiles(root, files, input()) : emptyGroup("file")));
			push("spec", () => (root ? searchSpecs(root, readers.specs, input()) : emptyGroup("spec")));

			let sessions: { sessions: readonly HistorySession[]; indexing: boolean } | null = null;
			if (kinds.has("chat") || kinds.has("transcript") || kinds.has("plan")) {
				try {
					sessions = await readers.sessions();
				} catch (error) {
					log.warn("search could not read the chat history", error);
					sessions = null;
				}
			}
			if (superseded()) return { seq, groups: [], superseded: true };
			const history = sessions;
			if (history) {
				const label = chatLabeler(workspaces);
				push("chat", () => searchChatTitles(history.sessions, history.indexing, label, input()));
				push("transcript", () =>
					searchTranscripts(history.sessions, history.indexing, label, input()),
				);
			} else {
				if (kinds.has("chat")) groups.push(emptyGroup("chat", "failed"));
				if (kinds.has("transcript")) groups.push(emptyGroup("transcript", "failed"));
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
			const workspaces = openWorkspaces(readers.projects());
			const { sessions } = await readers.sessions();
			const session = sessions.find((candidate) => candidate.sessionId === target.sessionId);
			if (!session || !chatLabeler(workspaces)(session.cwd)) {
				return { kind: "unavailable", reason: "missing" };
			}
			return transcriptPreview(session, target.messageIndex, target.anchorText?.slice(0, 120));
		},

		invalidateRoot(root) {
			files.invalidate(root);
			readers.invalidateSpecs(root);
		},

		forgetClient(clientKey) {
			latestSeq.delete(clientKey);
		},
	};
}

function focusEntry(
	entries: readonly HistorySession["entries"][number][],
	messageIndex: number | undefined,
	anchorText: string | undefined,
): number {
	if (messageIndex === undefined) return -1;
	const at = entries.findIndex((entry) => entry.messageIndex === messageIndex);
	if (anchorText === undefined || (at !== -1 && entries[at]?.text.startsWith(anchorText)))
		return at;
	let best = -1;
	for (const [index, entry] of entries.entries()) {
		if (!entry.text.startsWith(anchorText)) continue;
		const nearer =
			best === -1 ||
			Math.abs(entry.messageIndex - messageIndex) <
				Math.abs((entries[best]?.messageIndex ?? 0) - messageIndex);
		if (nearer) best = index;
	}
	return best;
}

function transcriptPreview(
	session: HistorySession,
	messageIndex?: number,
	anchorText?: string,
): SearchPreviewResult {
	const entries = session.entries;
	const focusAt = focusEntry(entries, messageIndex, anchorText);
	const half = Math.floor(SEARCH_BUDGET.previewMessages / 2);
	const start = focusAt === -1 ? 0 : Math.max(0, focusAt - half);
	const window = entries.slice(start, start + SEARCH_BUDGET.previewMessages);
	const messages: SearchPreviewMessage[] = window.map((entry, offset) => ({
		role: entry.role,
		messageIndex: entry.messageIndex,
		text:
			entry.text.length > SEARCH_BUDGET.previewMessageChars
				? `${entry.text.slice(0, SEARCH_BUDGET.previewMessageChars)}…`
				: entry.text,
		focus: start + offset === focusAt,
	}));
	return {
		kind: "transcript",
		title: session.title ?? "",
		messages,
		truncated: window.length < entries.length,
	};
}
