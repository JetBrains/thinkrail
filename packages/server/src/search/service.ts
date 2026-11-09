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
	MAX_SEARCH_GROUP_LIMIT,
	MAX_SEARCH_QUERY_LENGTH,
	parseMatchTerms,
	SEARCH_KINDS,
} from "@thinkrail/contracts";
import type { HistorySession, HistoryState } from "../history";
import { logger } from "../log";
import type { SpecSnapshot } from "../spec";
import type { StoredPlanFile } from "../todos";
import { FileListCache } from "./files";
import { deadlineAt, emptyGroup } from "./hits";
import {
	type ChatLabel,
	type FileStat,
	type ProviderInput,
	type SearchRoot,
	searchFiles,
	searchPlans,
	searchSpecs,
	searchTranscripts,
} from "./providers";

const log = logger("search");

export interface HistoryRead {
	readonly sessions: readonly HistorySession[];
	readonly state: HistoryState;
}

export interface SearchReaders {
	readonly projects: () => Project[];
	readonly workspaces: () => Workspace[];
	readonly sessions: () => Promise<HistoryRead>;
	readonly specs: (root: string) => SpecSnapshot;
	readonly plans: (root: string) => StoredPlanFile[];
	readonly invalidateSpecs: (root: string) => void;
	readonly ensureDefault: (projectId: string) => Promise<unknown>;
	readonly watchRoot: (workspaceId: string) => void;
	readonly files?: FileListCache;
	readonly stat: FileStat;
	readonly now?: () => number;
	readonly wallClock?: () => number;
}

export interface SearchService {
	query(params: WsParams<"search.query">): Promise<SearchQueryResult>;
	preview(target: SearchPreviewTarget): Promise<SearchPreviewResult>;
	invalidateRoot(root: string): void;
}

const DEFAULT_SEARCH_GROUP_LIMIT = 20;

export const SEARCH_BUDGET = {
	reloadWaitMs: 150,
	queryMs: 300,
	providerMs: 120,
	previewMessages: 7,
	previewMessageChars: 600,
	previewIndexRounds: 40,
	provisionRetryMs: 5_000,
} as const;

function clampLimit(limit: number | undefined): number {
	if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_SEARCH_GROUP_LIMIT;
	return Math.max(1, Math.min(MAX_SEARCH_GROUP_LIMIT, Math.floor(limit)));
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
		(workspace) => workspace.projectId === project.id && workspace.kind === "default",
	);
	if (!defaultRecord) return null;
	return { root: project.path, projectId: project.id, workspaceId: defaultRecord.id };
}

function settledWithin(waits: readonly (Promise<unknown> | null)[], ms: number): Promise<void> {
	const pending = waits.filter((wait): wait is Promise<unknown> => wait !== null);
	if (pending.length === 0) return Promise.resolve();
	return Promise.race([Promise.allSettled(pending).then(() => {}), Bun.sleep(ms)]);
}

export function createSearchService(readers: SearchReaders): SearchService {
	const files = readers.files ?? new FileListCache();
	const now = readers.now ?? (() => performance.now());
	const wallClock = readers.wallClock ?? Date.now;
	const ensuring = new Map<string, Promise<unknown>>();

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

	const ensureFailedAt = new Map<string, number>();

	const ensureDefault = (projectId: string): Promise<unknown> => {
		const failedAt = ensureFailedAt.get(projectId);
		if (failedAt !== undefined && wallClock() - failedAt < SEARCH_BUDGET.provisionRetryMs) {
			return Promise.reject(new Error("the project's folder could not be provisioned"));
		}
		let pending = ensuring.get(projectId);
		if (!pending) {
			pending = readers
				.ensureDefault(projectId)
				.then(
					(result) => {
						ensureFailedAt.delete(projectId);
						return result;
					},
					(error: unknown) => {
						if (!ensureFailedAt.has(projectId)) {
							log.warn("search could not provision the project's folder", error);
						}
						ensureFailedAt.set(projectId, wallClock());
						throw error;
					},
				)
				.finally(() => ensuring.delete(projectId));
			ensuring.set(projectId, pending);
		}
		return pending;
	};

	const rootFor = async (context: WsParams<"search.query">["context"]) => {
		const projects = readers.projects();
		const found = resolveSearchRoot(projects, openWorkspaces(projects), context);
		const projectId = context.projectId;
		if (found || !projectId || !projects.some((project) => project.id === projectId)) {
			return { root: found, failed: false };
		}
		try {
			await ensureDefault(projectId);
		} catch {
			return { root: null, failed: true };
		}
		const again = readers.projects();
		const root = resolveSearchRoot(again, openWorkspaces(again), context);
		return { root, failed: root === null };
	};

	const specRebuild = (root: string): Promise<void> | null => {
		try {
			return readers.specs(root).rebuilding;
		} catch {
			return null;
		}
	};

	const readHistory = (): Promise<HistoryRead | null> =>
		readers.sessions().catch((error: unknown) => {
			log.warn("search could not read the chat history", error);
			return null;
		});

	return {
		async query(params) {
			const terms = parseMatchTerms(params.query.slice(0, MAX_SEARCH_QUERY_LENGTH));
			const kinds = new Set<SearchKind>(params.kinds ?? SEARCH_KINDS);
			if (terms.length === 0) return { groups: [...kinds].map((kind) => emptyGroup(kind)) };

			const rooted = kinds.has("file") || kinds.has("spec");
			const { root, failed: rootFailed } = rooted
				? await rootFor(params.context)
				: { root: null, failed: false };
			if (root) readers.watchRoot(root.workspaceId);
			const history = kinds.has("transcript") || kinds.has("plan") ? readHistory() : null;
			await settledWithin(
				[
					root && kinds.has("file") ? files.refresh(root.root) : null,
					root && kinds.has("spec") ? specRebuild(root.root) : null,
					history,
				],
				SEARCH_BUDGET.reloadWaitMs,
			);

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
			const rootless = (kind: SearchKind) => emptyGroup(kind, rootFailed ? "failed" : "ready");

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
			push("file", () =>
				root ? searchFiles(root, files, input(), readers.stat) : rootless("file"),
			);
			push("spec", () => (root ? searchSpecs(root, readers.specs, input()) : rootless("spec")));

			const read = history ? await history : null;
			const workspaces = openWorkspaces(readers.projects());
			push("transcript", () =>
				read
					? searchTranscripts(read.sessions, read.state, chatLabeler(workspaces), input())
					: emptyGroup("transcript", "failed"),
			);
			push("plan", () =>
				read
					? searchPlans(
							workspaces,
							readers.plans,
							new Set(read.sessions.map((session) => session.sessionId)),
							input(),
							read.state,
						)
					: emptyGroup("plan", "failed"),
			);
			return { groups };
		},

		async preview(target) {
			for (let round = 0; ; round += 1) {
				const { sessions, state } = await readers.sessions();
				if (state === "ready" || round >= SEARCH_BUDGET.previewIndexRounds) {
					const session = sessions.find((candidate) => candidate.sessionId === target.sessionId);
					const workspaces = openWorkspaces(readers.projects());
					if (!session || !chatLabeler(workspaces)(session.cwd)) return { kind: "unavailable" };
					return transcriptPreview(session, target.messageIndex, target.anchorText?.slice(0, 120));
				}
			}
		},

		invalidateRoot(root) {
			files.invalidate(root);
			readers.invalidateSpecs(root);
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
	return { kind: "transcript", title: session.title ?? "", messages };
}
