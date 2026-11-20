import type {
	PanelChatSession,
	PanelHost,
	PanelPeekEntry,
	PanelWorkspaceTarget,
} from "@thinkrail/extension-api/web";
import type { AttemptLive, BoardView, Card, Category } from "./api";
import type { Initiative, RoadmapView, Rollup, Schedule, ScheduleEdge } from "./roadmapApi";

export function liveOf(overrides: Partial<AttemptLive> = {}): AttemptLive {
	return {
		workspaceId: "w1",
		sessionId: "s1",
		open: true,
		chat: { state: "working", unread: false, title: "Board chat" },
		plan: null,
		diff: null,
		pr: null,
		...overrides,
	};
}

export function cardOf(overrides: Partial<Card> = {}): Card {
	return {
		id: "TR-1",
		source: { kind: "native", ref: "TR-1" },
		title: "Ship the board",
		description: "",
		acceptance: [],
		type: "feature",
		labels: [],
		blocks: [],
		specRefs: [],
		rank: 1,
		category: "backlog",
		column: "backlog",
		attempts: [],
		createdBy: "human",
		createdAt: 1,
		live: [],
		blockedBy: [],
		taskSpecs: [],
		...overrides,
	};
}

export function boardOf(cards: Card[], overrides: Partial<BoardView> = {}): BoardView {
	return {
		projectId: "p1",
		projectName: "ThinkRail",
		prefix: "TR",
		settings: {
			preset: "agentic-kanban",
			wipLimits: { needsYou: 3, review: 5, agents: 3 },
			followSelection: false,
			github: { enabled: false, filter: "open" },
		},
		columns: [
			{ id: "triage", categories: ["triage"], hidden: true },
			{ id: "backlog", categories: ["backlog"] },
			{ id: "ready", categories: ["unstarted"] },
			{ id: "designing", categories: ["started"], workflow: "brainstorm" },
			{ id: "building", categories: ["started"], workflow: "implement" },
			{ id: "review", categories: ["review"] },
			{ id: "done", categories: ["completed"] },
			{ id: "canceled", categories: ["canceled"], hidden: true },
		],
		cards,
		wip: {
			needsYou: { count: 0, limit: 3 },
			review: { count: 0, limit: 5 },
			agents: { count: 0, limit: 3 },
		},
		github: { enabled: false, filter: "open", loading: false, fetchedAt: null, error: null },
		...overrides,
	};
}

export interface FakeHost {
	host: PanelHost;
	queries: { method: string; params: unknown }[];
	peeks: PanelPeekEntry[];
	files: { workspaceId: string; path: string }[];
	workspaces: PanelWorkspaceTarget[];
	chats: PanelChatSession[];
	views: string[];
}

export function fakeHost(answer: (method: string) => unknown = () => ({})): FakeHost {
	const queries: { method: string; params: unknown }[] = [];
	const peeks: PanelPeekEntry[] = [];
	const files: { workspaceId: string; path: string }[] = [];
	const workspaces: PanelWorkspaceTarget[] = [];
	const chats: PanelChatSession[] = [];
	const views: string[] = [];
	const host: PanelHost = {
		query: async (method, params) => {
			queries.push({ method, params });
			return answer(method);
		},
		openChat: () => {},
		openPanel: () => {},
		renderToolCall: () => null,
		renderChat: (chat) => {
			chats.push(chat);
			return `chat:${chat.workspaceId}/${chat.sessionId}`;
		},
		openFile: (workspaceId, path) => files.push({ workspaceId, path }),
		openWorkspace: (target) => workspaces.push(target),
		peek: (entry) => peeks.push(entry),
		onEvent: () => () => {},
		openView: (view) => views.push(view),
		scope: { workspaceId: "w0", projectId: "p1" },
		hostProtocol: 130,
		hostApiVersion: 1,
	};
	return { host, queries, peeks, files, workspaces, chats, views };
}

export function scheduleOf(overrides: Partial<Schedule> = {}): Schedule {
	return { today: 20_000, finish: 20_000, nodes: [], edges: [], criticalPath: [], ...overrides };
}

export function edgeOf(
	from: string,
	to: string,
	overrides: Partial<ScheduleEdge> = {},
): ScheduleEdge {
	return { from, to, critical: false, conflict: false, ...overrides };
}

export function initiativeOf(overrides: Partial<Initiative> = {}): Initiative {
	return {
		id: "I-1",
		title: "Planning surface",
		outcome: "Work is visible and starts in one place.",
		criteria: [],
		horizon: "now",
		rank: 1,
		specRefs: [],
		updates: [],
		cardIds: [],
		externalCards: [],
		createdAt: 1,
		updatedAt: 1,
		depth: 0,
		childIds: [],
		memberCardIds: [],
		memberExternalCards: [],
		...overrides,
	};
}

export function rollupOf(
	counts: Partial<Record<Category, number>> = {},
	extra: Partial<Rollup> = {},
) {
	const byCategory = {
		triage: 0,
		backlog: 0,
		unstarted: 0,
		started: 0,
		review: 0,
		completed: 0,
		canceled: 0,
		...counts,
	};
	return {
		cards: Object.values(byCategory).reduce((sum, count) => sum + count, 0),
		byCategory,
		points: { total: 0, completed: 0 },
		agents: { working: 0, waiting: 0, failed: 0 },
		blocked: 0,
		timeSpentMs: 0,
		...extra,
	} satisfies Rollup;
}

export function viewOf(
	initiatives: Initiative[],
	overrides: Partial<RoadmapView> = {},
): RoadmapView {
	return {
		projectId: "p1",
		projectName: "ThinkRail",
		initiatives,
		projects: [],
		externalCards: [],
		rollups: { initiatives: {}, projects: {}, milestones: {} },
		health: {},
		forecast: {},
		schedule: scheduleOf(),
		critical: {},
		insufficientData: { throughput: true, initiatives: [] },
		...overrides,
	};
}
