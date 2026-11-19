import type { PanelHost } from "@thinkrail/extension-api/web";
import type { AttemptLive, BoardView, Card } from "./api";

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
		title: "Ship the board",
		description: "",
		acceptance: [],
		type: "feature",
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
		...overrides,
	};
}

export interface FakeHost {
	host: PanelHost;
	queries: { method: string; params: unknown }[];
}

export function fakeHost(answer: (method: string) => unknown = () => ({})): FakeHost {
	const queries: { method: string; params: unknown }[] = [];
	const host: PanelHost = {
		query: async (method, params) => {
			queries.push({ method, params });
			return answer(method);
		},
		openChat: () => {},
		openPanel: () => {},
		renderToolCall: () => null,
		openFile: () => {},
		openWorkspace: () => {},
		peek: () => {},
		onEvent: () => () => {},
		scope: { workspaceId: "w0", projectId: "p1" },
		hostProtocol: 130,
		hostApiVersion: 1,
	};
	return { host, queries };
}
