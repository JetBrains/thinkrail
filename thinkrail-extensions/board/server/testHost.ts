import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionCreateWorkspaceParams,
	ExtensionHostEvents,
	ExtensionHostEventType,
	ExtensionHostProject,
	ExtensionHostServices,
	ExtensionWorkspaceFacts,
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
	published: { type: string; payload: unknown; scope: unknown }[];
	warnings: string[];
	emit<T extends ExtensionHostEventType>(type: T, payload: ExtensionHostEvents[T]): void;
	listeners(): number;
}

export function project(id: string, name: string): ExtensionHostProject {
	return { id, name, kind: "repository", workspaces: [] };
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
		published: [],
		warnings: [],
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
				return { workspaceId: `w${next}`, sessionId: `s${next}`, branch: `workspace-${next}` };
			},
			sendToChat: refused,
			stopChat: refused,
			openPr: refused,
			runInWorkspace: refused,
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
