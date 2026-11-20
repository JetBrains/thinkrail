import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionConformanceResult,
	ExtensionContainer,
	ExtensionCreateWorkspaceParams,
	ExtensionHostEvents,
	ExtensionHostEventType,
	ExtensionHostProject,
	ExtensionHostServices,
	ExtensionOpenspecTree,
	ExtensionPlanSummary,
	ExtensionReviewCommentInput,
	ExtensionReviewConformanceParams,
	ExtensionRunResult,
	ExtensionStartChatParams,
	ExtensionTaskSpec,
	ExtensionWakeOrchestratorParams,
	ExtensionWorkspaceFacts,
	ExtensionWriteWorkspaceFileParams,
	GhSetupProblem,
} from "@thinkrail/extension-api/server";

type Listener = (payload: unknown) => void | Promise<void>;

export interface TestHost {
	host: ExtensionHostServices;
	root: string;
	projects: ExtensionHostProject[];
	facts: Map<string, ExtensionWorkspaceFacts>;
	/** cwd → `{ projectId, workspaceId }` for `sessionScope().locate`. */
	places: Map<string, { projectId: string; workspaceId: string }>;
	created: ExtensionCreateWorkspaceParams[];
	/** Every `startChat`, in order, and how the host answers it. */
	chats: ExtensionStartChatParams[];
	chat: { kickoffError?: string };
	published: { type: string; payload: unknown; scope: unknown }[];
	warnings: string[];
	/** Workspace id → its task-specs, for `taskSpecs`. */
	taskSpecs: Map<string, ExtensionTaskSpec[]>;
	/** `workspaceId:specId:heading` → the section's text, for `specSection`. */
	sections: Map<string, string>;
	/** Workspace id → its `openspec/` tree, for `openspecTree`. */
	openspec: Map<string, ExtensionOpenspecTree>;
	/** Every `sendToChat`, in order. */
	sent: { sessionId: string; text: string; mode: string }[];
	/** Every `runInWorkspace`, in order. */
	runs: { workspaceId: string; argv: string[] }[];
	/** Answers a `runInWorkspace` (the fake `gh`), at once or later; by default a failed run. */
	run: {
		answer: (
			argv: readonly string[],
			workspaceId: string,
		) => ExtensionRunResult | Promise<ExtensionRunResult>;
	};
	/** Every `writeWorkspaceFile`, in order; a path in `refusePaths` is refused like the host would. */
	writes: ExtensionWriteWorkspaceFileParams[];
	refusePaths: Set<string>;
	/** Every `assist` prompt, in order, and how the host answers it. */
	asks: string[];
	assist: { answer: (prompt: string) => { text: string } | null };
	gh: { problem: GhSetupProblem | null };
	/** The host's containers, as `containers()` answers them; `createContainer` adds one. */
	containers: ExtensionContainer[];
	/** Every `startOrchestrator` and `wakeOrchestrator`, in order. */
	orchestratorStarts: string[];
	wakes: ExtensionWakeOrchestratorParams[];
	/** Every `reviewConformance`, in order, and how the fake reviewer answers it. */
	reviews: ExtensionReviewConformanceParams[];
	reviewer: {
		answer: (params: ExtensionReviewConformanceParams) => Promise<ExtensionConformanceResult>;
	};
	/** Every `addReviewComments`, in order. */
	comments: { workspaceId: string; author?: string; comments: ExtensionReviewCommentInput[] }[];
	/** `workspaceId:sessionId` → the chat's plan, for `planSummary`. */
	plans: Map<string, ExtensionPlanSummary>;
	emit<T extends ExtensionHostEventType>(type: T, payload: ExtensionHostEvents[T]): void;
	listeners(): number;
}

export function project(
	id: string,
	name: string,
	workspaces: ExtensionHostProject["workspaces"] = [],
): ExtensionHostProject {
	return { id, name, kind: "repository", workspaces };
}

export function ran(out: string, ok = true): ExtensionRunResult {
	return { ok, out, err: ok ? "" : out, timedOut: false };
}

export function facts(
	id: string,
	overrides: Partial<ExtensionWorkspaceFacts> = {},
): ExtensionWorkspaceFacts {
	return {
		id,
		projectId: "p1",
		name: id,
		branch: id,
		baseBranch: "main",
		kind: "worktree",
		review: null,
		diff: { added: 0, removed: 0 },
		chats: [],
		...overrides,
	};
}

export function createTestHost(): TestHost {
	const root = mkdtempSync(join(tmpdir(), "board-"));
	const listeners = new Map<string, Set<Listener>>();
	const state: Omit<TestHost, "host" | "emit" | "listeners"> = {
		root,
		projects: [project("p1", "ThinkRail")],
		facts: new Map(),
		places: new Map(),
		created: [],
		chats: [],
		chat: {},
		published: [],
		warnings: [],
		taskSpecs: new Map(),
		sections: new Map(),
		openspec: new Map(),
		sent: [],
		runs: [],
		run: { answer: () => ran("gh: not in this test", false) },
		writes: [],
		refusePaths: new Set(),
		asks: [],
		assist: { answer: () => null },
		gh: { problem: null },
		containers: [],
		orchestratorStarts: [],
		wakes: [],
		reviews: [],
		reviewer: { answer: async () => ({ items: [], summary: "" }) },
		comments: [],
		plans: new Map(),
	};
	let next = 0;
	const refused = async (): Promise<never> => {
		throw new Error("not in this test");
	};
	const host: ExtensionHostServices = {
		dataDir: join(root, "extensions", "board"),
		log: { info: () => {}, warn: (message) => state.warnings.push(message) },
		signal: new AbortController().signal,
		actions: {
			createWorkspace: async (params) => {
				state.created.push(params);
				next += 1;
				const workspaceId = `w${next}`;
				const into = state.containers.find((container) => container.id === params.into);
				if (params.into && !into) throw new Error(`Unknown container: ${params.into}`);
				if (into) into.workspaceIds = [...into.workspaceIds, workspaceId];
				return { workspaceId, sessionId: `s${next}`, branch: `workspace-${next}` };
			},
			startChat: async (params) => {
				state.chats.push(params);
				next += 1;
				return {
					workspaceId: params.workspaceId,
					sessionId: `s${next}`,
					...(state.chat.kickoffError ? { kickoffError: state.chat.kickoffError } : {}),
				};
			},
			sendToChat: async (params) => {
				state.sent.push(params);
			},
			stopChat: refused,
			openPr: refused,
			runInWorkspace: async ({ workspaceId, argv }) => {
				state.runs.push({ workspaceId, argv: [...argv] });
				return state.run.answer(argv, workspaceId);
			},
			writeWorkspaceFile: async (params) => {
				if (state.refusePaths.has(params.path))
					throw new Error(`${params.path} is not a plain relative path inside the worktree.`);
				state.writes.push(params);
				return {
					workspaceId: params.workspaceId,
					path: params.path,
					bytes: Buffer.byteLength(params.content),
				};
			},
			assist: async ({ prompt }) => {
				state.asks.push(prompt);
				return state.assist.answer(prompt);
			},
			createContainer: async ({ name, workspaceIds }) => {
				const container: ExtensionContainer = {
					id: `c${state.containers.length + 1}`,
					name: name ?? workspaceIds[0] ?? "",
					workspaceIds: [...workspaceIds],
					orchestrator: null,
				};
				state.containers.push(container);
				return container;
			},
			startOrchestrator: async ({ containerId }) => {
				state.orchestratorStarts.push(containerId);
				const container = state.containers.find((candidate) => candidate.id === containerId);
				if (!container) throw new Error(`Unknown container: ${containerId}`);
				container.orchestrator ??= {
					projectId: "chats",
					workspaceId: `chat-${containerId}`,
					sessionId: `orch-${containerId}`,
				};
				return { containerId, ...container.orchestrator };
			},
			wakeOrchestrator: async (params) => {
				const container = state.containers.find((candidate) => candidate.id === params.containerId);
				if (!container?.orchestrator) throw new Error("no orchestrator to wake");
				state.wakes.push(params);
			},
			reviewConformance: async (params) => {
				state.reviews.push(params);
				return state.reviewer.answer(params);
			},
			addReviewComments: async ({ workspaceId, author, comments }) => {
				state.comments.push({
					workspaceId,
					...(author !== undefined ? { author } : {}),
					comments: [...comments],
				});
				const offset = state.comments.reduce((sum, call) => sum + call.comments.length, 0);
				return {
					comments: comments.map((comment, index) => ({
						id: `rc_${offset - comments.length + index + 1}`,
						path: comment.path,
						line: comment.line,
						anchored: true,
					})),
				};
			},
		},
		events: {
			subscribe(type, listener) {
				const set = listeners.get(type) ?? new Set();
				set.add(listener as Listener);
				listeners.set(type, set);
				return () => set.delete(listener as Listener);
			},
		},
		publish: (type, payload, scope) => state.published.push({ type, payload, scope }),
		workspaceFacts: async (workspaceId) => state.facts.get(workspaceId) ?? null,
		containers: () => state.containers,
		taskSpecs: async (workspaceId) =>
			state.facts.has(workspaceId) ? (state.taskSpecs.get(workspaceId) ?? []) : null,
		specSection: async (workspaceId, specId, heading) =>
			state.sections.get(`${workspaceId}:${specId}:${heading}`) ?? null,
		openspecTree: async (workspaceId) => state.openspec.get(workspaceId) ?? null,
		planSummary: async (workspaceId, sessionId) =>
			state.facts.has(workspaceId)
				? (state.plans.get(`${workspaceId}:${sessionId}`) ?? { summary: null, steps: [] })
				: null,
		githubProblem: async () => state.gh.problem,
		sessionsRoot: () => join(root, "sessions"),
		sessionScope: () => ({
			projects: state.projects,
			locate: (cwd) => {
				const place = state.places.get(cwd);
				return place
					? { ...place, workspaceName: place.workspaceId, workspace: "open" }
					: { projectId: null, workspaceId: null, workspaceName: null, workspace: "none" };
			},
		}),
		childTranscriptDirs: async () => [],
		sessionStatus: () => ({ live: false, completion: null }),
		messageAnchor: async () => null,
		contextWindow: async () => null,
		models: async () => [],
		turnReceipts: async () => [],
		turnTree: async () => null,
		ensureArtifactsDir: async () => null,
	};
	return {
		...state,
		host,
		emit: (type, payload) => {
			for (const listener of listeners.get(type) ?? []) void listener(payload);
		},
		listeners: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
	};
}
