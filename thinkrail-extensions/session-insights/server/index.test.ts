import { afterAll, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionHostProject,
	ExtensionHostServices,
	ExtensionSessionPlacement,
	ExtensionSessionStatus,
	ServerExtension,
} from "@thinkrail/extension-api/server";
import type {
	DayTimelineResult,
	ErrorDetailResult,
	EventAnchorResult,
	EventGetResult,
	ExportResult,
	FileDetailResult,
	FindingsHideResult,
	FindingsListResult,
	LabelsGetResult,
	LabelsSetResult,
	RequestDiffResult,
	SessionAnalysisResult,
	SessionContextResult,
	SessionCostResult,
	SessionFilesResult,
	SessionListRow,
	SessionSubagentsResult,
	SessionSummaryResult,
	SessionsAlignResult,
	SessionsListResult,
	SessionsSearchResult,
	SessionTimelineResult,
	SessionTraceResult,
	SlicesCompareResult,
	StatsHotspotsResult,
	StatsSequencesResult,
	StatsUsageResult,
	SubagentGetResult,
	TraceSearchResult,
} from "@thinkrail/pi-session-insights/core";
import corePackage from "@thinkrail/pi-session-insights/package.json";
import sessionInsights from "./index";

const API_VERSION = sessionInsights.apiVersion;

const root = mkdtempSync(join(tmpdir(), "ext-session-insights-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const START = Date.parse("2026-11-01T10:00:00.000Z");

function spend(tokens: number, cost: number) {
	return {
		input: tokens,
		output: tokens,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 2 * tokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
	};
}

class Transcript {
	readonly id: string;
	private readonly lines: unknown[];
	private clock: number;
	private sequence = 0;
	private parent: string | null = null;

	constructor(id: string, cwd: string, start: number) {
		this.id = id;
		this.clock = start;
		this.lines = [
			{ type: "session", version: 3, id, timestamp: new Date(start).toISOString(), cwd },
		];
	}

	private entry(fields: Record<string, unknown>): this {
		this.clock += 60_000;
		this.sequence += 1;
		const id = `${this.id}-${this.sequence}`;
		this.lines.push({
			id,
			parentId: this.parent,
			timestamp: new Date(this.clock).toISOString(),
			...fields,
		});
		this.parent = id;
		return this;
	}

	user(text: string): this {
		return this.entry({
			type: "message",
			message: { role: "user", content: text, timestamp: this.clock },
		});
	}

	assistant(options: {
		provider?: string;
		tokens: number;
		cost: number;
		calls?: readonly { id: string; name: string; arguments?: Record<string, unknown> }[];
	}): this {
		const calls = options.calls ?? [];
		return this.entry({
			type: "message",
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "Working on it." },
					...calls.map((call) => ({
						type: "toolCall",
						id: call.id,
						name: call.name,
						arguments: call.arguments ?? {},
					})),
				],
				api: "faux",
				provider: options.provider ?? "anthropic",
				model: "test-model",
				usage: spend(options.tokens, options.cost),
				stopReason: calls.length > 0 ? "toolUse" : "stop",
				timestamp: this.clock,
			},
		});
	}

	toolResult(id: string, name: string, isError = false, details?: unknown): this {
		return this.entry({
			type: "message",
			message: {
				role: "toolResult",
				toolCallId: id,
				toolName: name,
				content: [{ type: "text", text: "done" }],
				isError,
				...(details === undefined ? {} : { details }),
				timestamp: this.clock,
			},
		});
	}

	subagentUsage(childId: string, tokens: number, cost: number): this {
		return this.entry({
			type: "usage",
			kind: "subagent",
			provider: "faux",
			model: "faux-child",
			usage: spend(tokens, cost),
			note: childId,
		});
	}

	named(name: string): this {
		return this.entry({ type: "session_info", name });
	}

	write(sessionsRoot: string, folder: string): string {
		const dir = join(sessionsRoot, folder);
		mkdirSync(dir, { recursive: true });
		const file = join(dir, `2026-11-01T10-00-00-000Z_${this.id}.jsonl`);
		writeFileSync(file, `${this.lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
		return file;
	}
}

function childRun(childSessionId: string, tokens: number, cost: number) {
	return {
		childSessionId,
		status: "completed",
		usage: { input: tokens, output: tokens, cacheRead: 0, cacheWrite: 0, cost },
	};
}

const PROJECTS: readonly ExtensionHostProject[] = [
	{
		id: "p1",
		name: "Alpha",
		kind: "repository",
		workspaces: [{ id: "w1", name: "main", kind: "default", branch: "main" }],
	},
	{
		id: "p2",
		name: "Beta",
		kind: "repository",
		workspaces: [{ id: "w2", name: "feature", kind: "worktree", branch: "feature" }],
	},
];

const PLACEMENTS: Readonly<Record<string, ExtensionSessionPlacement | null>> = {
	"/work/alpha": { projectId: "p1", workspaceId: "w1", workspaceName: "main", workspace: "open" },
	"/work/beta": { projectId: "p2", workspaceId: "w2", workspaceName: "feature", workspace: "open" },
	"/work/alpha-gone": {
		projectId: "p1",
		workspaceId: null,
		workspaceName: "old-feature",
		workspace: "removed",
	},
	"/elsewhere": { projectId: null, workspaceId: null, workspaceName: null, workspace: "none" },
	"/deleting-chat": null,
};

interface FakeHost {
	host: ExtensionHostServices;
	warnings: { message: string; error: unknown }[];
	sessionsRootReads: number;
}

function fakeHost(
	name: string,
	overrides: {
		childTranscriptDirs?: ExtensionHostServices["childTranscriptDirs"];
		status?: Readonly<Record<string, ExtensionSessionStatus>>;
		messageAnchor?: ExtensionHostServices["messageAnchor"];
		contextWindow?: ExtensionHostServices["contextWindow"];
		turnReceipts?: ExtensionHostServices["turnReceipts"];
		turnTree?: ExtensionHostServices["turnTree"];
		signal?: AbortSignal;
	} = {},
): FakeHost {
	const noActions = async (): Promise<never> => {
		throw new Error("session insights takes no host actions");
	};
	const sessions = join(root, name, "sessions");
	mkdirSync(sessions, { recursive: true });
	const fake: FakeHost = {
		warnings: [],
		sessionsRootReads: 0,
		host: {
			dataDir: join(root, name, "data", "extensions", "session-insights"),
			log: {
				info: () => {},
				warn: (message, error) => fake.warnings.push({ message, error }),
			},
			signal: overrides.signal ?? new AbortController().signal,
			actions: {
				createWorkspace: noActions,
				startChat: noActions,
				sendToChat: noActions,
				stopChat: noActions,
				openPr: noActions,
				runInWorkspace: noActions,
				assist: noActions,
			},
			events: { subscribe: () => () => {} },
			publish: () => {},
			workspaceFacts: async () => null,
			taskSpecs: async () => null,
			specSection: async () => null,
			githubProblem: async () => null,
			sessionsRoot: () => {
				fake.sessionsRootReads += 1;
				return sessions;
			},
			sessionScope: (scope) => ({
				projects: PROJECTS,
				locate: (cwd) => {
					const placement = Object.hasOwn(PLACEMENTS, cwd) ? PLACEMENTS[cwd] : undefined;
					if (!placement) return null;
					if (scope.kind === "all") return placement;
					return scope.kind === "project" && placement.projectId === scope.projectId
						? placement
						: null;
				},
			}),
			childTranscriptDirs: overrides.childTranscriptDirs ?? (async () => []),
			sessionStatus: (sessionId) =>
				overrides.status?.[sessionId] ?? { live: false, completion: null },
			messageAnchor: overrides.messageAnchor ?? (async () => null),
			contextWindow: overrides.contextWindow ?? (async () => null),
			models: async () => [],
			turnReceipts: overrides.turnReceipts ?? (async () => []),
			turnTree: overrides.turnTree ?? (async () => null),
			ensureArtifactsDir: async (workspaceId) =>
				workspaceId === "w1"
					? {
							dir: join(root, name, "worktree", ".thinkrail", "context"),
							relative: ".thinkrail/context/",
						}
					: null,
		},
	};
	return fake;
}

function sessionsRootOf(fake: FakeHost): string {
	const path = fake.host.sessionsRoot();
	fake.sessionsRootReads -= 1;
	return path;
}

function listQuery(host: ExtensionHostServices) {
	const query = sessionInsights.queries?.(host)["sessions.list"];
	if (!query) throw new Error("sessions.list is not declared");
	return query;
}

async function listUntilReady(
	host: ExtensionHostServices,
	params: unknown,
): Promise<SessionsListResult> {
	const query = listQuery(host);
	for (let attempt = 0; attempt < 50; attempt++) {
		const result = (await query(params)) as SessionsListResult;
		if (result.state.phase === "ready") return result;
		await Bun.sleep(20);
	}
	throw new Error("the session index never became ready");
}

function row(result: SessionsListResult, sessionId: string): SessionListRow {
	const found = result.rows.find((candidate) => candidate.sessionId === sessionId);
	if (!found) throw new Error(`no row for ${sessionId}`);
	return found;
}

function seed(fake: FakeHost): void {
	const sessions = sessionsRootOf(fake);
	new Transcript("priced", "/work/alpha", START)
		.named("Fix the login flow")
		.user("Please fix the login flow   when the token\nexpires")
		.assistant({
			tokens: 100,
			cost: 0.5,
			calls: [
				{ id: "c1", name: "bash" },
				{ id: "c2", name: "read", arguments: { path: "/work/alpha/src/login.ts" } },
			],
		})
		.toolResult("c1", "bash", true)
		.toolResult("c2", "read")
		.assistant({ tokens: 50, cost: 0.25, calls: [{ id: "a1", name: "Agent" }] })
		.toolResult("a1", "Agent", false, childRun("kid", 40, 0.3))
		.subagentUsage("kid", 10, 0.1)
		.write(sessions, "alpha");
	new Transcript("bridge", "/work/beta", START + 3_600_000)
		.user("Draft the release notes")
		.assistant({ provider: "claude-bridge", tokens: 500, cost: 0 })
		.write(sessions, "beta");
	new Transcript("gone", "/work/alpha-gone", START - 3_600_000)
		.user("Old work")
		.assistant({ tokens: 10, cost: 0.01, calls: [{ id: "a2", name: "Agent" }] })
		.toolResult("a2", "Agent", false, childRun("lost", 5, 0.01))
		.write(sessions, "alpha-gone");
	new Transcript("orphan", "/elsewhere", START - 7_200_000)
		.user("Scratch")
		.assistant({ tokens: 1, cost: 0.001 })
		.write(sessions, "elsewhere");
	new Transcript("hidden", "/deleting-chat", START)
		.user("Going away")
		.assistant({ tokens: 1, cost: 0.001 })
		.write(sessions, "deleting");
}

describe("session-insights server descriptor", () => {
	test("declares its read-only queries, the core's api version and nothing for pi sessions", () => {
		const descriptor: ServerExtension = sessionInsights;
		expect(descriptor.name).toBe("session-insights");
		expect(descriptor.title).toBe("Session insights");
		expect(descriptor.description).toContain("nothing leaves it");
		expect(descriptor.extensions).toEqual([]);
		expect(descriptor.sessionExtensions).toBeUndefined();
		expect(descriptor.childExtensions).toBeUndefined();
		expect(descriptor.interactiveTools).toBeUndefined();
		expect(descriptor.skillPackages).toBeUndefined();
		expect(descriptor.settings).toBeUndefined();
		// The panel replaces the package's vanilla /insights: a user's install of it stays out of sessions.
		expect(descriptor.supersedesPackages).toEqual([corePackage.name]);
		expect(descriptor.apiVersion).toBe(10);
		const fake = fakeHost("descriptor");
		expect(Object.keys(sessionInsights.queries?.(fake.host) ?? {})).toEqual([
			"sessions.list",
			"session.summary",
			"session.trace",
			"event.get",
			"event.anchor",
			"trace.search",
			"session.timeline",
			"day.timeline",
			"session.analysis",
			"error.detail",
			"session.subagents",
			"subagent.get",
			"session.context",
			"request.diff",
			"session.cost",
			"session.files",
			"file.detail",
			"stats.usage",
			"stats.hotspots",
			"findings.list",
			"findings.hide",
			"stats.sequences",
			"slices.compare",
			"sessions.align",
			"search",
			"labels.get",
			"labels.set",
			"export.html",
			"export.trace",
			"export.fixture",
		]);
	});

	test("building the queries does no I/O, as the catalog builds them against inert services", () => {
		const refuse = () => {
			throw new Error("no host access while building queries");
		};
		const inert: ExtensionHostServices = {
			dataDir: join(root, "inert", "never-created"),
			log: { info: refuse, warn: refuse },
			signal: new AbortController().signal,
			actions: {
				createWorkspace: refuse,
				startChat: refuse,
				sendToChat: refuse,
				stopChat: refuse,
				openPr: refuse,
				runInWorkspace: refuse,
				assist: refuse,
			},
			events: { subscribe: refuse },
			publish: refuse,
			workspaceFacts: refuse,
			taskSpecs: refuse,
			specSection: refuse,
			githubProblem: refuse,
			sessionsRoot: refuse,
			sessionScope: refuse,
			childTranscriptDirs: () => Promise.reject(new Error("inert")),
			sessionStatus: refuse,
			messageAnchor: refuse,
			contextWindow: refuse,
			models: refuse,
			turnReceipts: refuse,
			turnTree: refuse,
			ensureArtifactsDir: refuse,
		};
		expect(() => sessionInsights.queries?.(inert)).not.toThrow();
		expect(existsSync(inert.dataDir)).toBe(false);
	});
});

describe("sessions.list", () => {
	test("lists the project's sessions with pi-recorded spend, counts and the subagent line", async () => {
		const fake = fakeHost("project", {
			status: {
				priced: {
					live: true,
					completion: { completionId: "run-1", outcome: "failed", failure: "error" },
				},
			},
		});
		seed(fake);
		const result = await listUntilReady(fake.host, { scope: { kind: "project", projectId: "p1" } });

		expect(result.apiVersion).toBe(API_VERSION);
		expect(result.state).toEqual({ phase: "ready", indexed: 5, total: 5 });
		expect(result.projects).toEqual([{ id: "p1", name: "Alpha", kind: "repository" }]);
		expect(result.rows.map((candidate) => candidate.sessionId)).toEqual(["priced", "gone"]);
		expect(result.sources.cost.length).toBeGreaterThan(0);

		const priced = row(result, "priced");
		expect(priced).toMatchObject({
			projectId: "p1",
			workspaceId: "w1",
			workspaceName: "main",
			workspaceState: "open",
			title: "Fix the login flow",
			firstPrompt: "Please fix the login flow when the token expires",
			live: true,
			outcome: "failed",
			start: { origin: "counted" },
			activeMs: { origin: "approximated" },
			toolCalls: { value: 3, origin: "counted" },
			toolErrors: { value: 1, origin: "counted" },
			subagents: { value: 1, origin: "counted" },
		});
		expect(priced.tokens).toEqual({
			value: { input: 160, output: 160, cacheRead: 0, cacheWrite: 0, total: 320 },
			origin: "recorded",
		});
		expect(priced.cost.origin).toBe("recorded");
		expect(priced.cost.value).toBeCloseTo(0.85, 12);
		expect(priced.subagentsOutside.origin).toBe("recorded");
		expect(priced.subagentsOutside.value?.cost).toBeCloseTo(0.2, 12);
		expect(priced.subagentsOutside.value?.tokens).toBe(60);
	});

	test("keeps sessions of a removed workspace listed, with subagent figures not measured", async () => {
		const fake = fakeHost("removed");
		seed(fake);
		const result = await listUntilReady(fake.host, { scope: { kind: "project", projectId: "p1" } });
		expect(row(result, "gone")).toMatchObject({
			workspaceId: null,
			workspaceName: "old-feature",
			workspaceState: "removed",
			live: false,
			outcome: null,
			subagents: { value: 1, origin: "notMeasured" },
			subagentsOutside: { origin: "notMeasured" },
		});
	});

	test("the all-projects scope adds other projects and sessions outside every project, never hidden ones", async () => {
		const fake = fakeHost("all");
		seed(fake);
		const result = await listUntilReady(fake.host, { scope: { kind: "all" } });
		expect(result.rows.map((candidate) => candidate.sessionId)).toEqual([
			"bridge",
			"priced",
			"gone",
			"orphan",
		]);
		expect(result.projects.map((project) => project.id)).toEqual(["p2", "p1"]);
		expect(row(result, "orphan")).toMatchObject({
			projectId: null,
			workspaceId: null,
			workspaceState: "none",
		});
	});

	test("a model that records $0 keeps its tokens and reads as not recorded", async () => {
		const fake = fakeHost("bridge");
		seed(fake);
		const result = await listUntilReady(fake.host, { scope: { kind: "project", projectId: "p2" } });
		const bridge = row(result, "bridge");
		expect(bridge.cost).toEqual({ value: 0, origin: "notRecorded" });
		expect(bridge.tokens.value?.total).toBe(1000);
		expect(bridge.tokens.origin).toBe("recorded");
		expect(bridge.subagentsOutside.value).toEqual({ cost: 0, tokens: 0 });
		expect(bridge.models).toEqual(["claude-bridge/test-model"]);
	});

	test("caches summaries under the extension's dataDir without message text", async () => {
		const fake = fakeHost("cache");
		seed(fake);
		await listUntilReady(fake.host, { scope: { kind: "all" } });
		const files = readdirSync(fake.host.dataDir);
		expect(files.length).toBeGreaterThan(0);
		const cached = files
			.map((file) => readFileSync(join(fake.host.dataDir, file), "utf8"))
			.join("");
		expect(cached).toContain("priced");
		expect(cached).not.toContain("Please fix the login flow");
		expect(cached).not.toContain("Working on it.");
	});

	test("one index serves every call: a session added later shows up on revalidation", async () => {
		const fake = fakeHost("index");
		const query = listQuery(fake.host);
		const empty = (await query({ scope: { kind: "all" } })) as SessionsListResult;
		expect(empty.rows).toEqual([]);
		new Transcript("later", "/work/alpha", START)
			.user("Later")
			.assistant({ tokens: 1, cost: 0.01 })
			.write(sessionsRootOf(fake), "alpha");
		const deadline = Date.now() + 5_000;
		let rows: readonly SessionListRow[] = [];
		while (Date.now() < deadline) {
			rows = ((await query({ scope: { kind: "all" } })) as SessionsListResult).rows;
			if (rows.length > 0) break;
			await Bun.sleep(100);
		}
		expect(rows.map((candidate) => candidate.sessionId)).toEqual(["later"]);
	});

	test("routes background index failures to the host log", async () => {
		const fake = fakeHost("log", {
			childTranscriptDirs: () => Promise.reject(new Error("delegation scan failed")),
		});
		seed(fake);
		await listUntilReady(fake.host, { scope: { kind: "all" } });
		expect(fake.warnings.length).toBeGreaterThan(0);
		expect(fake.warnings[0]?.message).toBe("session index refresh failed");
		expect(fake.warnings[0]?.error).toBeInstanceOf(Error);
	});

	test("rejects malformed params before touching the sessions root", async () => {
		const fake = fakeHost("params");
		const query = listQuery(fake.host);
		for (const params of [
			undefined,
			null,
			{},
			{ scope: "all" },
			{ scope: { kind: "project" } },
			{ scope: { kind: "project", projectId: "" } },
			{ scope: { kind: "workspace", workspaceId: "w1" } },
		]) {
			await expect(Promise.resolve(query(params))).rejects.toThrow("Invalid sessions.list params");
		}
		expect(fake.sessionsRootReads).toBe(0);
		expect(existsSync(fake.host.dataDir)).toBe(false);
	});
});

function query(host: ExtensionHostServices, name: string) {
	const found = sessionInsights.queries?.(host)[name];
	if (!found) throw new Error(`${name} is not declared`);
	return found;
}

async function ready(fake: FakeHost): Promise<void> {
	await listUntilReady(fake.host, { scope: { kind: "all" } });
}

describe("one session's analysis", () => {
	test("session.summary gives the header row with the project name and wall time, hidden ones as null", async () => {
		const fake = fakeHost("summary");
		seed(fake);
		await ready(fake);
		const summary = query(fake.host, "session.summary");
		const result = (await summary({ sessionId: "priced" })) as SessionSummaryResult;
		expect(result.apiVersion).toBe(API_VERSION);
		expect(result.session).toMatchObject({
			sessionId: "priced",
			projectName: "Alpha",
			workspaceName: "main",
			title: "Fix the login flow",
			wallMs: { value: 7 * 60_000, origin: "counted" },
			toolCalls: { value: 3 },
		});
		expect(((await summary({ sessionId: "hidden" })) as SessionSummaryResult).session).toBeNull();
		expect(((await summary({ sessionId: "nope" })) as SessionSummaryResult).session).toBeNull();
		await expect(Promise.resolve(summary({}))).rejects.toThrow("Invalid session.summary params");
	});

	test("session.trace pages the skeleton; event.get re-reads one body; event.anchor asks the host", async () => {
		const anchors: { file: string; entryId: string }[] = [];
		const fake = fakeHost("trace", {
			messageAnchor: async (file, entryId) => {
				anchors.push({ file, entryId });
				return { messageIndex: 1, anchorText: "Working on it.", entryId, exact: true };
			},
		});
		seed(fake);
		await ready(fake);
		const page = (await query(
			fake.host,
			"session.trace",
		)({
			sessionId: "priced",
			limit: 3,
		})) as SessionTraceResult;
		expect(page.found).toBe(true);
		expect(page.meta?.errors).toBe(1);
		expect(page.events.map((event) => event.kind)).toEqual(["mark", "turn", "llm"]);
		expect(page.next).toBe(3);
		const rest = (await query(
			fake.host,
			"session.trace",
		)({
			sessionId: "priced",
			cursor: 3,
		})) as SessionTraceResult;
		const bash = rest.events.find((event) => event.kind === "tool" && event.tool === "bash");
		expect(bash).toMatchObject({ error: true, family: "execution" });
		expect(rest.events.some((event) => event.kind === "subagent" && event.childId === "kid")).toBe(
			true,
		);
		expect(rest.next).toBeNull();

		const body = (await query(
			fake.host,
			"event.get",
		)({
			sessionId: "priced",
			eventId: bash?.id,
		})) as EventGetResult;
		expect(body.body).toMatchObject({ kind: "tool", tool: "bash", result: { text: "done" } });

		const anchor = (await query(
			fake.host,
			"event.anchor",
		)({
			sessionId: "priced",
			eventId: bash?.id,
		})) as EventAnchorResult;
		expect(anchor.anchor).toEqual({
			messageIndex: 1,
			anchorText: "Working on it.",
			toolCallId: "c1",
		});
		expect(anchors).toEqual([
			{ file: expect.stringContaining("priced.jsonl"), entryId: "priced-3" },
		]);

		const hidden = (await query(
			fake.host,
			"session.trace",
		)({ sessionId: "hidden" })) as SessionTraceResult;
		expect(hidden).toMatchObject({ found: false, events: [] });
		await expect(
			Promise.resolve(query(fake.host, "event.get")({ sessionId: "priced" })),
		).rejects.toThrow("Invalid event.get params");
	});

	test("event.anchor drops the tool call when only an ancestor is shown", async () => {
		const fake = fakeHost("ancestor", {
			messageAnchor: async () => ({
				messageIndex: 0,
				anchorText: "Please",
				entryId: "priced-2",
				exact: false,
			}),
		});
		seed(fake);
		await ready(fake);
		const page = (await query(
			fake.host,
			"session.trace",
		)({ sessionId: "priced" })) as SessionTraceResult;
		const read = page.events.find((event) => event.kind === "tool" && event.tool === "read");
		const anchor = (await query(
			fake.host,
			"event.anchor",
		)({
			sessionId: "priced",
			eventId: read?.id,
		})) as EventAnchorResult;
		expect(anchor.anchor).toEqual({ messageIndex: 0, anchorText: "Please", approximate: true });
	});

	test("event.anchor passes the call a text-less message shows, even when only an ancestor is shown", async () => {
		const fake = fakeHost("textless", {
			messageAnchor: async () => ({
				messageIndex: 2,
				anchorText: "",
				entryId: "priced-3",
				exact: false,
				toolCallId: "shown-call",
			}),
		});
		seed(fake);
		await ready(fake);
		const page = (await query(
			fake.host,
			"session.trace",
		)({ sessionId: "priced" })) as SessionTraceResult;
		const read = page.events.find((event) => event.kind === "tool" && event.tool === "read");
		const anchor = (await query(
			fake.host,
			"event.anchor",
		)({ sessionId: "priced", eventId: read?.id })) as EventAnchorResult;
		expect(anchor.anchor).toEqual({
			messageIndex: 2,
			anchorText: "",
			toolCallId: "shown-call",
			approximate: true,
		});
	});

	test("trace.search returns matching event ids in trace order", async () => {
		const fake = fakeHost("search");
		seed(fake);
		await ready(fake);
		const result = (await query(
			fake.host,
			"trace.search",
		)({
			sessionId: "priced",
			query: "working",
		})) as TraceSearchResult;
		expect(result.found).toBe(true);
		expect(result.ids).toEqual(["priced-3", "priced-6"]);
		expect(result.truncated).toBe(false);
	});
});

describe("subagents, plan and errors", () => {
	function withChild(name: string) {
		const delegation = join(root, name, "delegation");
		const fake = fakeHost(name, {
			childTranscriptDirs: async (sessionId) =>
				sessionId === "priced" ? [join(delegation, "priced")] : [],
		});
		seed(fake);
		new Transcript("kid", "/work/alpha", START + 5 * 60_000)
			.user("Audit the login flow")
			.assistant({ tokens: 20, cost: 0.2, calls: [{ id: "k1", name: "bash" }] })
			.toolResult("k1", "bash", true)
			.assistant({ tokens: 20, cost: 0.1 })
			.write(delegation, "priced");
		return fake;
	}

	test("session.analysis gives chains, clusters and the transcripts the trace can expand", async () => {
		const fake = withChild("analysis");
		await ready(fake);
		const result = (await query(
			fake.host,
			"session.analysis",
		)({
			sessionId: "priced",
		})) as SessionAnalysisResult;
		expect(result).toMatchObject({ apiVersion: API_VERSION, found: true });
		expect(result.analysis?.transcripts).toEqual(["kid"]);
		expect(result.analysis?.chains.map((chain) => [chain.name, chain.outcome])).toEqual([
			["bash", "changedApproach"],
		]);
		expect(result.analysis?.toolRecovery).toEqual([
			{ tool: "bash", failures: 1, chains: 1, recovered: 0, changedApproach: 1, gaveUp: 0 },
		]);
		expect(result.sources.recovery.length).toBeGreaterThan(0);
		const detail = (await query(
			fake.host,
			"error.detail",
		)({
			sessionId: "priced",
			chain: 0,
		})) as ErrorDetailResult;
		expect(detail.detail?.attempts).toHaveLength(1);
		expect(detail.detail?.attempts[0]?.error?.text).toBe("done");
		const missing = (await query(
			fake.host,
			"error.detail",
		)({
			sessionId: "priced",
			chain: 5,
		})) as ErrorDetailResult;
		expect(missing).toMatchObject({ found: false, detail: null });
		const hidden = (await query(
			fake.host,
			"session.analysis",
		)({
			sessionId: "hidden",
		})) as SessionAnalysisResult;
		expect(hidden).toMatchObject({ found: false, analysis: null });
	});

	test("session.subagents and subagent.get read the waves; the trace pages a child's transcript", async () => {
		const fake = withChild("waves");
		await ready(fake);
		const view = (await query(
			fake.host,
			"session.subagents",
		)({
			sessionId: "priced",
		})) as SessionSubagentsResult;
		expect(view.subagents?.waves.map((wave) => wave.childIds)).toEqual([["kid"]]);
		const run = view.subagents?.runs[0];
		expect(run).toMatchObject({
			childId: "kid",
			transcript: "available",
			rationale: { source: "text", text: "Working on it." },
			result: { via: "Agent", text: "done" },
		});
		expect(run?.activity?.errors).toBe(1);
		expect(run?.consumedBy).toBeNull();
		const detail = (await query(
			fake.host,
			"subagent.get",
		)({
			sessionId: "priced",
			childId: "kid",
		})) as SubagentGetResult;
		expect(detail.detail?.failures).toEqual([
			{ eventId: "tool:kid-2:0", tool: "bash", line: "done" },
		]);
		const page = (await query(
			fake.host,
			"session.trace",
		)({
			sessionId: "priced",
			childId: "kid",
		})) as SessionTraceResult;
		expect(page.events.map((event) => event.kind)).toEqual(["turn", "llm", "tool", "llm"]);
		const body = (await query(
			fake.host,
			"event.get",
		)({
			sessionId: "priced",
			childId: "kid",
			eventId: "tool:kid-2:0",
		})) as EventGetResult;
		expect(body.body).toMatchObject({ kind: "tool", tool: "bash" });
		const unknown = (await query(
			fake.host,
			"session.trace",
		)({
			sessionId: "priced",
			childId: "nobody",
		})) as SessionTraceResult;
		expect(unknown.found).toBe(false);
		const removed = (await query(
			fake.host,
			"session.subagents",
		)({
			sessionId: "gone",
		})) as SessionSubagentsResult;
		expect(removed.subagents?.runs.map((candidate) => candidate.transcript)).toEqual(["removed"]);
		await expect(
			Promise.resolve(query(fake.host, "subagent.get")({ sessionId: "priced" })),
		).rejects.toThrow("Invalid subagent.get params");
	});
});

function localDayOf(ms: number): string {
	const date = new Date(ms);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

describe("timelines", () => {
	test("session.timeline gives turn cards, lanes and counters with the host's context window", async () => {
		const asked: string[] = [];
		const fake = fakeHost("timeline", {
			contextWindow: async (provider, model) => {
				asked.push(`${provider}/${model}`);
				return 200_000;
			},
		});
		seed(fake);
		await ready(fake);
		const timeline = query(fake.host, "session.timeline");
		const result = (await timeline({ sessionId: "priced" })) as SessionTimelineResult;
		expect(result).toMatchObject({ apiVersion: API_VERSION, found: true });
		const [card] = result.timeline?.turns ?? [];
		expect(card).toMatchObject({
			n: 1,
			trigger: "prompt",
			llmCalls: { value: 2 },
			toolCalls: { value: 3 },
			errors: { value: 1 },
			subagents: { value: 1 },
		});
		expect(result.timeline?.limits).toEqual([
			{
				model: "anthropic/test-model",
				value: 200_000,
				origin: "host",
				host: 200_000,
				observed: 100,
			},
		]);
		expect(asked).toEqual(["anthropic/test-model"]);
		expect(result.timeline?.spend.at(-1)?.cost).toBeCloseTo(0.85, 12);
		expect(result.timeline?.withSubagents?.at(-1)?.cost).toBeCloseTo(1.05, 12);
		expect(result.sources.contextWindow.length).toBeGreaterThan(0);
		expect(
			((await timeline({ sessionId: "hidden" })) as SessionTimelineResult).timeline,
		).toBeNull();
		await expect(Promise.resolve(timeline({ id: "priced" }))).rejects.toThrow(
			"Invalid session.timeline params",
		);
	});

	test("day.timeline lists a scope's sessions of one host-local day, the latest by default", async () => {
		const fake = fakeHost("day");
		seed(fake);
		await ready(fake);
		const day = query(fake.host, "day.timeline");
		const latest = (await day({ scope: { kind: "all" } })) as DayTimelineResult;
		const starts: Record<string, number> = {
			priced: START,
			bridge: START + 3_600_000,
			gone: START - 3_600_000,
			orphan: START - 7_200_000,
		};
		const days = [...new Set(Object.values(starts).map(localDayOf))].sort();
		expect(latest.apiVersion).toBe(API_VERSION);
		expect(latest.days).toEqual(days);
		expect(latest.day).toBe(days.at(-1) ?? null);
		const expected = Object.entries(starts)
			.filter(([, start]) => localDayOf(start) === latest.day)
			.sort(([, a], [, b]) => a - b)
			.map(([id]) => id);
		expect(latest.sessions.map((row) => row.sessionId)).toEqual(expected);
		expect(latest.sessions.find((row) => row.sessionId === "priced")?.turns).toHaveLength(1);
		const project = (await day({
			scope: { kind: "project", projectId: "p2" },
			day: localDayOf(START + 3_600_000),
		})) as DayTimelineResult;
		expect(project.sessions.map((row) => row.sessionId)).toEqual(["bridge"]);
		expect(project.totals?.cost.origin).toBe("notRecorded");
		await expect(Promise.resolve(day({ scope: { kind: "all" }, day: "soon" }))).rejects.toThrow(
			"Invalid day.timeline params",
		);
	});
});

describe("context, cost and files", () => {
	test("session.context, session.cost and request.diff read a session's calls; hidden ones are not found", async () => {
		const fake = fakeHost("context", { contextWindow: async () => 200_000 });
		seed(fake);
		await ready(fake);
		const context = (await query(
			fake.host,
			"session.context",
		)({
			sessionId: "priced",
		})) as SessionContextResult;
		expect(context).toMatchObject({ apiVersion: API_VERSION, found: true });
		expect(context.context?.calls.map((call) => [call.n, call.total])).toEqual([
			[1, 100],
			[2, 50],
		]);
		expect(context.context?.limits[0]?.origin).toBe("host");
		const cost = (await query(
			fake.host,
			"session.cost",
		)({
			sessionId: "priced",
		})) as SessionCostResult;
		expect(cost.cost?.headline).toBe("cost");
		expect(cost.cost?.moments[0]?.cost.value).toBeCloseTo(0.75, 12);
		const callId = context.context?.calls[1]?.id ?? "";
		const diff = (await query(
			fake.host,
			"request.diff",
		)({
			sessionId: "priced",
			callId,
		})) as RequestDiffResult;
		expect(diff.found).toBe(true);
		expect(diff.diff?.previous?.n).toBe(1);
		expect(diff.diff?.newCount).toBe(3);
		for (const name of ["session.context", "session.cost", "session.files"]) {
			const hidden = (await query(fake.host, name)({ sessionId: "hidden" })) as { found: boolean };
			expect(hidden.found).toBe(false);
		}
		await expect(
			Promise.resolve(query(fake.host, "request.diff")({ sessionId: "priced" })),
		).rejects.toThrow("Invalid request.diff params");
	});

	test("session.files joins the host's receipts for an open workspace only, and file.detail opens one file", async () => {
		const asked: string[] = [];
		const fake = fakeHost("files", {
			turnReceipts: async (sessionId) => {
				asked.push(sessionId);
				return [
					{
						startedAt: START,
						settledAt: START + 1,
						changes: [{ path: "src/login.ts", status: "modified", added: 4, removed: 1 }],
					},
				];
			},
		});
		seed(fake);
		await ready(fake);
		const files = (await query(
			fake.host,
			"session.files",
		)({
			sessionId: "priced",
		})) as SessionFilesResult;
		expect(files.files?.receipts).toBe(true);
		expect(files.files?.rows).toEqual([
			expect.objectContaining({
				path: "src/login.ts",
				inside: true,
				reads: 1,
				receipt: { added: 4, removed: 1, runs: 1 },
			}),
		]);
		const gone = (await query(
			fake.host,
			"session.files",
		)({
			sessionId: "gone",
		})) as SessionFilesResult;
		expect(gone.files?.receipts).toBe(false);
		expect(asked).toEqual(["priced"]);
		const detail = (await query(
			fake.host,
			"file.detail",
		)({
			sessionId: "priced",
			path: "src/login.ts",
		})) as FileDetailResult;
		expect(detail.detail?.touches.map((touch) => touch.op)).toEqual(["read"]);
		expect(detail.detail?.receipts).toHaveLength(1);
		const unknown = (await query(
			fake.host,
			"file.detail",
		)({
			sessionId: "priced",
			path: "nope.ts",
		})) as FileDetailResult;
		expect(unknown.found).toBe(false);
	});
});

async function settled<T extends { digests: { ready: number; total: number } }>(
	run: () => Promise<T>,
): Promise<T> {
	for (let attempt = 0; attempt < 100; attempt++) {
		const result = await run();
		if (result.digests.ready === result.digests.total) return result;
		await Bun.sleep(20);
	}
	throw new Error("the digests never finished");
}

describe("statistics", () => {
	test("stats.usage reads the scope's sessions once and splits spend by model and project", async () => {
		const fake = fakeHost("stats-usage", { contextWindow: async () => 200_000 });
		seed(fake);
		await ready(fake);
		const usage = query(fake.host, "stats.usage");
		const all = await settled(
			async () => (await usage({ scope: { kind: "all" } })) as StatsUsageResult,
		);
		expect(all.apiVersion).toBe(API_VERSION);
		expect(all.sessions.map((session) => session.sessionId)).toEqual([
			"bridge",
			"priced",
			"gone",
			"orphan",
		]);
		expect(all.usage.byModel.map((series) => series.key)).toEqual([
			"claude-bridge/test-model",
			"anthropic/test-model",
			"subagents",
		]);
		expect(
			all.usage.models.find((row) => row.model === "anthropic/test-model")?.contextWindow,
		).toEqual({ value: 200_000, origin: "host" });
		expect(all.usage.projects.map((row) => row.projectId)).toEqual(["p2", "p1", null]);
		expect(all.usage.outside?.totalCost).toBeCloseTo(0.21, 12);
		const project = (await usage({
			scope: { kind: "project", projectId: "p2" },
		})) as StatsUsageResult;
		expect(project.sessions.map((session) => session.sessionId)).toEqual(["bridge"]);
		expect(project.usage.headline).toBe("tokens");
		await expect(Promise.resolve(usage({ scope: { kind: "nope" } }))).rejects.toThrow(
			"Invalid stats.usage params",
		);
	});

	test("stats.hotspots lists workspace-relative files only and findings hide in the data folder", async () => {
		const fake = fakeHost("stats-findings");
		seed(fake);
		await ready(fake);
		const hotspots = await settled(
			async () =>
				(await query(
					fake.host,
					"stats.hotspots",
				)({ scope: { kind: "all" } })) as StatsHotspotsResult,
		);
		expect(hotspots.hotspots.files.map((file) => [file.projectId, file.path, file.reads])).toEqual([
			["p1", "src/login.ts", 1],
		]);
		expect(hotspots.hotspots.files[0]?.workspaceId).toBe("w1");
		const list = query(fake.host, "findings.list");
		const findings = await settled(
			async () => (await list({ scope: { kind: "all" } })) as FindingsListResult,
		);
		expect(findings.findings.map((finding) => finding.id)).toEqual(["subagents:outside"]);
		const hide = query(fake.host, "findings.hide");
		const hidden = (await hide({ id: "subagents:outside", hidden: true })) as FindingsHideResult;
		expect(hidden).toEqual({ apiVersion: API_VERSION, hidden: ["subagents:outside"] });
		expect(readdirSync(fake.host.dataDir)).toContain("findings.json");
		const again = (await list({ scope: { kind: "all" } })) as FindingsListResult;
		expect(again.findings[0]?.hidden).toBe(true);
		await expect(Promise.resolve(hide({ id: "x" }))).rejects.toThrow(
			"Invalid findings.hide params",
		);
	});

	test("stats.sequences counts the scope's transitions and slices.compare splits it by model", async () => {
		const fake = fakeHost("stats-sequences");
		seed(fake);
		await ready(fake);
		const queries = sessionInsights.queries?.(fake.host) ?? {};
		const sequences = queries["stats.sequences"];
		const compare = queries["slices.compare"];
		if (!sequences || !compare) throw new Error("the statistics queries are not declared");
		const result = await settled(
			async () => (await sequences({ scope: { kind: "all" } })) as StatsSequencesResult,
		);
		expect(result.apiVersion).toBe(API_VERSION);
		expect(result.sequences.calls).toBe(4);
		expect(result.sequences.activities).toEqual(["read", "run", "subagent"]);
		expect(result.sequences.flow.failures).toBe(1);
		await expect(Promise.resolve(sequences({ scope: { kind: "nope" } }))).rejects.toThrow(
			"Invalid stats.sequences params",
		);
		const sliced = await settled(
			async () => (await compare({ scope: { kind: "all" }, by: "model" })) as SlicesCompareResult,
		);
		expect(sliced.compare.by).toBe("model");
		expect(sliced.compare.options.models.map((option) => option.key)).toEqual([
			"anthropic/test-model",
			"claude-bridge/test-model",
		]);
		const verdict = (id: string) =>
			sliced.compare.metrics.find((metric) => metric.id === id)?.verdict;
		expect(verdict("tokens")).toBe("tooFew");
		expect(verdict("failedShare")).toBe("noData");
		await expect(Promise.resolve(compare({ scope: { kind: "all" }, by: "mood" }))).rejects.toThrow(
			"Invalid slices.compare params",
		);
	});

	test("sessions.align aligns two shown sessions and refuses hidden or unknown ones", async () => {
		const fake = fakeHost("align");
		seed(fake);
		await ready(fake);
		const align = query(fake.host, "sessions.align");
		const result = (await align({ a: "priced", b: "gone" })) as SessionsAlignResult;
		expect(result).toMatchObject({ apiVersion: API_VERSION, found: true });
		expect(result.alignment?.a.sessionId).toBe("priced");
		expect(result.alignment?.pairs).toEqual([{ a: 0, b: 0, similarity: 0, by: "first" }]);
		expect(result.alignment?.rows.map((row) => row.op)).toEqual(["onlyA", "onlyA", "same"]);
		expect(result.alignment?.next).toBeNull();
		for (const missing of [
			{ a: "priced", b: "hidden" },
			{ a: "nope", b: "priced" },
		])
			expect(await align(missing)).toMatchObject({ found: false, alignment: null });
		await expect(Promise.resolve(align({ a: "priced" }))).rejects.toThrow(
			"Invalid sessions.align params",
		);
	});
});

describe("search", () => {
	test("finds events across the scope's shown sessions, filtered and paged by the panel's job", async () => {
		const fake = fakeHost("search");
		seed(fake);
		await ready(fake);
		const search = query(fake.host, "search");
		const ask = async (params: Record<string, unknown>) =>
			(await search({
				scope: { kind: "all" },
				client: "panel",
				...params,
			})) as SessionsSearchResult;
		const failing = await ask({ seq: 1, query: "tool:bash error:yes", facets: true });
		expect(failing).toMatchObject({ apiVersion: API_VERSION, seq: 1, status: "done" });
		expect(failing.sessions.map((session) => session.sessionId)).toEqual(["priced"]);
		expect(failing.groups[0]?.events.map((hit) => [hit.eventId, hit.kind, hit.error])).toEqual([
			["tool:priced-3:0", "tool", true],
		]);
		expect(failing.total).toEqual({ events: 1, sessions: 1, exact: true });
		expect(failing.vocabulary?.tool.map((item) => item.value)).toEqual(["Agent", "bash", "read"]);
		expect(failing.vocabulary?.file).toEqual([{ value: "src/login.ts", count: 1 }]);
		const text = await ask({ seq: 2, query: "login" });
		expect(text.groups.flatMap((group) => group.events.map((hit) => hit.kind))).toEqual([
			"turn",
			"tool",
		]);
		expect(text.groups[0]?.events[0]?.snippet?.text).toBe(
			"Please fix the login flow when the token expires",
		);
		const scoped = (await search({
			scope: { kind: "project", projectId: "p2" },
			client: "panel",
			seq: 3,
			query: "release",
		})) as SessionsSearchResult;
		expect(scoped.sessions.map((session) => session.sessionId)).toEqual(["bridge"]);
		expect((await ask({ seq: 2, query: "login" })).status).toBe("superseded");
		expect((await ask({ seq: 4, query: "going away" })).total.events).toBe(0);
		await expect(Promise.resolve(search({ scope: { kind: "all" }, query: "x" }))).rejects.toThrow(
			"Invalid search params",
		);
	});
});

describe("while the index is still being built", () => {
	test("a session it has not reached is pending, not gone, and a search started then reads it once indexed", async () => {
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const fake = fakeHost("cold-index", {
			childTranscriptDirs: async (sessionId) => {
				if (sessionId === "early") await gate;
				return [];
			},
		});
		const sessions = sessionsRootOf(fake);
		for (const [id, folder, at, prompt] of [
			["early", "1-alpha", 0, "deploy the API"],
			["late", "2-alpha", 7_200_000, "deploy the worker"],
			["later", "3-alpha", 3_600_000, "write the docs"],
		] as const)
			new Transcript(id, "/work/alpha", START + at)
				.user(prompt)
				.assistant({ tokens: 10, cost: 0.01 })
				.write(sessions, folder);
		const queries = sessionInsights.queries?.(fake.host);
		if (!queries) throw new Error("no queries");
		const ask = async <T>(name: string, params: unknown) => (await queries[name]?.(params)) as T;
		const search = (params: Record<string, unknown>) =>
			ask<SessionsSearchResult>("search", { scope: { kind: "all" }, client: "panel", ...params });

		const summary = await ask<SessionSummaryResult>("session.summary", { sessionId: "late" });
		expect(summary).toMatchObject({ session: null, pending: true });
		expect(summary.state.phase).toBe("cold");
		expect(await ask<SessionTraceResult>("session.trace", { sessionId: "late" })).toMatchObject({
			found: false,
			pending: true,
		});
		expect(
			await ask<SessionsAlignResult>("sessions.align", { a: "early", b: "late" }),
		).toMatchObject({ found: false, pending: true });
		const indexed = await ask<SessionSummaryResult>("session.summary", { sessionId: "early" });
		expect(indexed).toMatchObject({ session: { sessionId: "early" }, pending: false });
		const first = await search({ seq: 1, query: "deploy" });
		expect(first.status).toBe("scanning");
		expect(first.total).toEqual({ events: 1, sessions: 1, exact: false });

		release();
		for (let attempt = 0; attempt < 50; attempt++) {
			const list = await ask<SessionsListResult>("sessions.list", { scope: { kind: "all" } });
			if (list.state.phase === "ready") break;
			await Bun.sleep(20);
		}
		let answer = first;
		const groups = first.groups.map((group) => first.sessions[group.session]?.sessionId);
		while (answer.next) {
			answer = await search({ seq: 1, query: "deploy", cursor: answer.next });
			groups.push(...answer.groups.map((group) => answer.sessions[group.session]?.sessionId));
		}
		expect(answer.status).toBe("done");
		expect(answer.total).toEqual({ events: 2, sessions: 2, exact: true });
		expect(groups).toEqual(["early", "late"]);
		expect(await ask<SessionSummaryResult>("session.summary", { sessionId: "late" })).toMatchObject(
			{ session: { sessionId: "late" }, pending: false },
		);
		expect((await ask<SessionTraceResult>("session.trace", { sessionId: "late" })).found).toBe(
			true,
		);
		expect(
			await ask<SessionSummaryResult>("session.summary", { sessionId: "never-written" }),
		).toMatchObject({ session: null, pending: false });
		expect(
			await ask<SessionTraceResult>("session.trace", { sessionId: "never-written" }),
		).toMatchObject({ found: false, pending: false });
	});
});

describe("switched off", () => {
	test("the index stops at its next yield and writes no summary cache; later queries start no work", async () => {
		const controller = new AbortController();
		const asked: string[] = [];
		const fake = fakeHost("switched-off", {
			signal: controller.signal,
			childTranscriptDirs: async (sessionId) => {
				asked.push(sessionId);
				controller.abort(new Error("switched off"));
				return [];
			},
		});
		seed(fake);
		const table = sessionInsights.queries?.(fake.host);
		const list = table?.["sessions.list"];
		const usage = table?.["stats.usage"];
		if (!list || !usage) throw new Error("sessions.list and stats.usage are declared");
		await list({ scope: { kind: "all" }, fresh: true });
		await Bun.sleep(50);
		expect(asked).toHaveLength(1);
		expect(existsSync(join(fake.host.dataDir, "summaries.v1.jsonl"))).toBe(false);

		const reads = fake.sessionsRootReads;
		const after = (await list({ scope: { kind: "all" }, fresh: true })) as SessionsListResult;
		expect(after.rows).toEqual([]);
		const stats = (await usage({ scope: { kind: "all" } })) as StatsUsageResult;
		expect(stats.digests).toEqual({ ready: 0, total: 0, stale: 0 });
		expect(fake.sessionsRootReads).toBe(reads);
		expect(fake.warnings).toEqual([]);
	});

	test("a table built again after a switch-on indexes from the cache the previous one wrote", async () => {
		const first = new AbortController();
		const fake = fakeHost("switched-on-again", { signal: first.signal });
		seed(fake);
		const before = await listUntilReady(fake.host, { scope: { kind: "all" } });
		first.abort(new Error("switched off"));
		const again = await listUntilReady(
			{ ...fake.host, signal: new AbortController().signal },
			{ scope: { kind: "all" } },
		);
		expect(again.rows.map((candidate) => candidate.sessionId)).toEqual(
			before.rows.map((candidate) => candidate.sessionId),
		);
	});
});

describe("labels", () => {
	test("labels.get and labels.set keep the user's labels and notes in the data folder only", async () => {
		const fake = fakeHost("labels");
		seed(fake);
		await ready(fake);
		const get = query(fake.host, "labels.get");
		const set = query(fake.host, "labels.set");
		expect(await get({})).toEqual({ apiVersion: API_VERSION, sessions: [], vocabulary: [] });
		const written = (await set({
			sessionId: "priced",
			labels: [" good ", "Login"],
			note: "Clean fix.",
		})) as LabelsSetResult;
		expect(written).toEqual({
			apiVersion: API_VERSION,
			ok: true,
			session: { sessionId: "priced", labels: ["good", "Login"], note: "Clean fix.", noted: true },
			vocabulary: [
				{ label: "good", sessions: 1 },
				{ label: "Login", sessions: 1 },
			],
		});
		await set({ sessionId: "bridge", labels: ["bad"], note: null });
		const all = (await get({})) as LabelsGetResult;
		expect(all.sessions.map((entry) => [entry.sessionId, entry.labels, entry.note])).toEqual([
			["bridge", ["bad"], null],
			["priced", ["good", "Login"], null],
		]);
		const asked = (await get({ sessionIds: ["priced"] })) as LabelsGetResult;
		expect(asked.sessions.find((entry) => entry.sessionId === "priced")?.note).toBe("Clean fix.");
		expect(readdirSync(fake.host.dataDir)).toContain("labels.json");
		const sessionFile = join(
			sessionsRootOf(fake),
			"alpha",
			"2026-11-01T10-00-00-000Z_priced.jsonl",
		);
		expect(readFileSync(sessionFile, "utf8")).not.toContain("Clean fix.");
		await expect(
			Promise.resolve(set({ sessionId: "priced", labels: ["x".repeat(41)] })),
		).rejects.toThrow("Invalid labels.set params");
		await expect(Promise.resolve(get({ sessionIds: "priced" }))).rejects.toThrow(
			"Invalid labels.get params",
		);
	});

	test("labels cut the slice comparison and filter the search with label:", async () => {
		const fake = fakeHost("labels-stats");
		seed(fake);
		await ready(fake);
		const set = query(fake.host, "labels.set");
		await set({ sessionId: "priced", labels: ["good"], note: null });
		await set({ sessionId: "gone", labels: ["good"], note: null });
		const compare = query(fake.host, "slices.compare");
		const sliced = await settled(
			async () => (await compare({ scope: { kind: "all" }, by: "label" })) as SlicesCompareResult,
		);
		expect(sliced.compare.options.labels).toEqual([{ key: "good", name: null, sessions: 2 }]);
		expect(
			sliced.compare.a.sessions.map((index) => sliced.sessions[index]?.sessionId).sort(),
		).toEqual(["gone", "priced"]);
		expect(
			sliced.compare.b.sessions.map((index) => sliced.sessions[index]?.sessionId).sort(),
		).toEqual(["bridge", "orphan"]);
		const search = query(fake.host, "search");
		const found = (await search({
			scope: { kind: "all" },
			client: "panel",
			seq: 1,
			query: "label:good",
			facets: true,
		})) as SessionsSearchResult;
		expect(found.sessions.map((session) => session.sessionId).sort()).toEqual(["gone", "priced"]);
		expect(found.vocabulary?.label.map((item) => item.value)).toEqual(["good"]);
	});
});

const SECRET = "sk-ant-api03-PLANTEDPLANTEDPLANTEDPLANTED";

function seedSecret(fake: FakeHost): void {
	new Transcript("secret", "/work/alpha", START + 7_200_000)
		.named("Deploy with a key")
		.user(`Deploy it, the key is ${SECRET} and mail ops@example.com`)
		.assistant({
			tokens: 20,
			cost: 0.02,
			calls: [{ id: "s1", name: "bash", arguments: { command: `API_KEY=${SECRET} ./deploy` } }],
		})
		.toolResult("s1", "bash")
		.assistant({ tokens: 5, cost: 0.01 })
		.user("Now the docs")
		.assistant({ tokens: 5, cost: 0.01 })
		.write(sessionsRootOf(fake), "alpha-secret");
}

describe("exports", () => {
	test("export.html writes a self-contained, masked page into the workspace's artifacts folder", async () => {
		const fake = fakeHost("export-html");
		seed(fake);
		seedSecret(fake);
		await ready(fake);
		await query(
			fake.host,
			"labels.set",
		)({ sessionId: "secret", labels: ["risky"], note: "Never share." });
		const exportHtml = query(fake.host, "export.html");
		const result = (await exportHtml({ sessionId: "secret", workspaceId: "w1" })) as ExportResult;
		expect(result).toMatchObject({
			apiVersion: API_VERSION,
			ok: true,
			kind: "html",
			files: 1,
			notes: [],
		});
		if (!result.ok) throw new Error("expected an export");
		expect(result.path).toBe(
			".thinkrail/context/session-insights/2026-11-01-deploy-with-a-key-secret.html",
		);
		const html = readFileSync(join(root, "export-html", "worktree", result.path), "utf8");
		expect(html).not.toContain(SECRET.slice(14));
		expect(html).not.toContain("ops@example.com");
		expect(html).not.toMatch(
			/\b(?:src|href)\s*=\s*["']?(?:https?:|\/\/)|url\(\s*["']?https?:|@import/i,
		);
		expect(html).not.toContain("risky");
		expect(html).not.toContain("Never share.");
		expect(html).toContain("Deploy with a key");
		const withLabels = (await exportHtml({
			sessionId: "secret",
			workspaceId: "w1",
			includeLabels: true,
		})) as ExportResult;
		expect(withLabels).toMatchObject({ ok: true, notes: ["labels"] });
		if (withLabels.ok) {
			expect(withLabels.path).toEndWith("-secret-2.html");
			const labelled = readFileSync(join(root, "export-html", "worktree", withLabels.path), "utf8");
			expect(labelled).toContain("risky");
			expect(labelled).toContain("Never share.");
		}
		expect(await exportHtml({ sessionId: "nope", workspaceId: "w1" })).toMatchObject({
			ok: false,
			code: "SESSION_NOT_FOUND",
		});
		expect(await exportHtml({ sessionId: "hidden", workspaceId: "w1" })).toMatchObject({
			ok: false,
			code: "SESSION_NOT_FOUND",
		});
		expect(await exportHtml({ sessionId: "secret", workspaceId: "w9" })).toMatchObject({
			ok: false,
			code: "NO_ARTIFACTS_DIR",
		});
		await expect(Promise.resolve(exportHtml({ sessionId: "secret" }))).rejects.toThrow(
			"Invalid export.html params",
		);
	});

	test("export.trace writes a Chrome trace with the session's threads and counters", async () => {
		const fake = fakeHost("export-trace");
		seed(fake);
		await ready(fake);
		const result = (await query(
			fake.host,
			"export.trace",
		)({
			sessionId: "priced",
			workspaceId: "w1",
		})) as ExportResult;
		expect(result).toMatchObject({ ok: true, kind: "trace", notes: ["childrenMissing"] });
		if (!result.ok) throw new Error("expected an export");
		expect(result.path).toEndWith(".trace.json");
		const trace = JSON.parse(
			readFileSync(join(root, "export-trace", "worktree", result.path), "utf8"),
		);
		expect(trace.displayTimeUnit).toBe("ms");
		expect(trace.traceEvents.length).toBeGreaterThan(5);
		expect(trace.traceEvents.map((event: { ph: string }) => event.ph)).toEqual(
			expect.arrayContaining(["M", "X", "C", "s", "f"]),
		);
		expect(trace.otherData.labels).toBeUndefined();
	});

	test("export.fixture cuts the last turn by default and snapshots the matching turn tree", async () => {
		const asked: number[] = [];
		const fake = fakeHost("export-fixture", {
			turnReceipts: async () => [
				{
					startedAt: START + 7_200_000 + 100_000,
					settledAt: START + 7_200_000 + 310_000,
					changes: [],
				},
			],
			turnTree: async (_sessionId, startedAt) => {
				asked.push(startedAt);
				return {
					kind: "files",
					files: [
						{ path: "NOTES.md", bytes: new TextEncoder().encode("# Notes\n") },
						{ path: "deploy.sh", bytes: new TextEncoder().encode(`API_KEY=${SECRET}\n`) },
					],
				};
			},
		});
		seed(fake);
		seedSecret(fake);
		await ready(fake);
		const fixture = query(fake.host, "export.fixture");
		const last = (await fixture({ sessionId: "secret", workspaceId: "w1" })) as ExportResult;
		expect(last).toMatchObject({ ok: true, kind: "fixture", notes: ["noSnapshot"] });
		expect(asked).toEqual([]);
		const first = (await fixture({
			sessionId: "secret",
			workspaceId: "w1",
			cut: { kind: "turn", turn: 1 },
			name: "deploy-first-turn",
		})) as ExportResult;
		expect(first).toMatchObject({
			ok: true,
			path: ".thinkrail/context/session-insights/fixtures/deploy-first-turn/",
			notes: ["snapshot"],
			files: 4,
		});
		expect(asked).toEqual([START + 7_200_000 + 100_000]);
		const folder = join(
			root,
			"export-fixture",
			"worktree",
			".thinkrail",
			"context",
			"session-insights",
			"fixtures",
			"deploy-first-turn",
		);
		expect(readdirSync(join(folder, "workspace")).sort()).toEqual(["NOTES.md.test", "deploy.sh"]);
		expect(readFileSync(join(folder, "workspace", "deploy.sh"), "utf8")).toBe(
			"API_KEY=[redacted]\n",
		);
		const session = readFileSync(join(folder, "session.jsonl"), "utf8");
		expect(session).not.toContain(SECRET.slice(14));
		expect(session).not.toContain("Now the docs");
		expect(JSON.parse(session.split("\n")[0] ?? "{}").cwd).toBe("/tmp/thinkrail-fixture/workspace");
		expect(
			await fixture({ sessionId: "secret", workspaceId: "w1", cut: { kind: "turn", turn: 7 } }),
		).toMatchObject({
			ok: false,
			code: "CUT_NOT_FOUND",
		});
	});
});
