import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore } from "@earendil-works/pi-ai/providers/faux";
import {
	type ExtensionContext,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { Workspace } from "@thinkrail/contracts";
import { TodoStore } from "pi-todos/core";
import {
	configurePiRuntime,
	createSession,
	disposeAllSessions,
	setSessionManagerFactory,
	setSessionPublisher,
	toWireModel,
} from "../agent";
import { createRequestReviewTool } from "../agent/requestReviewTool";
import { initializeAnalytics, resetAnalyticsForTests, shutdownAnalytics } from "../analytics";
import { saveWorkspaces } from "../persistence";
import * as reviews from "../reviews";
import { getReviewSnapshot } from "../reviews";
import { resetConfigCache, updateConfig } from "../settings";
import * as todos from "../todos";
import { todoReviewAutoCycles, todoReviewRecord } from "../todos";
import { itemReviewActive } from "./planReviewQueue";
import {
	installRequestReviewSeam,
	maybeAutoReReview,
	type ReviewRunner,
	startPlanReview,
} from "./requestReview";
import { isItemUnderActiveReview } from "./todoReview";

let dataDir: string;
let worktree: string;
const WS = "ws-planreview";

function modelDef(id: string) {
	return {
		id,
		name: id,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 4096,
	};
}

const faux = createFauxCore({
	provider: "faux-worker",
	api: "faux-worker",
	models: [modelDef("faux-worker-model")],
	tokensPerSecond: 2000,
});

let priorAgentDir: string | undefined;
let priorOffline: string | undefined;

beforeAll(async () => {
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "trpi-planreview-agentdir-"));
	priorOffline = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("faux-worker", {
		api: faux.api,
		baseUrl: "http://faux-worker.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [{ ...modelDef("faux-worker-model"), api: faux.api }],
	});
	configurePiRuntime(runtime);
	setSessionManagerFactory(() => SessionManager.inMemory());
	setSessionPublisher(() => {});
});

afterAll(() => {
	disposeAllSessions();
	if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
	if (priorOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = priorOffline;
});

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "planreview-data-"));
	worktree = mkdtempSync(join(tmpdir(), "planreview-wt-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	resetConfigCache();
	writeFileSync(join(worktree, "a.ts"), "const a = 1;\nconst b = 2;\n");
	saveWorkspaces([
		{
			id: WS,
			projectId: "p1",
			name: "w",
			branch: "main",
			baseBranch: "main",
			worktreePath: worktree,
			createdAt: 0,
		} as Workspace,
	]);
});

afterEach(() => {
	delete process.env.THINKRAIL_DATA_DIR;
	resetConfigCache();
	rmSync(dataDir, { recursive: true, force: true });
	rmSync(worktree, { recursive: true, force: true });
});

const verdictRunner =
	(finalText: string, onRun?: () => void): ReviewRunner =>
	async () => {
		onRun?.();
		return { childSessionId: "child", status: "completed" as const, finalText };
	};

const approve = '```json\n{ "verdict": "approve", "findings": [] }\n```';
const requestChanges = [
	"```json",
	'{ "verdict": "request_changes", "summary": "off-by-one",',
	'  "findings": [ { "id": "f1", "path": "a.ts", "startLine": 1, "body": "loop bound is wrong" } ] }',
	"```",
].join("\n");

/** A real (faux-model) worker chat: the fix message can only land on a session that actually exists. */
async function workerSession(): Promise<string> {
	const created = await createSession({
		cwd: worktree,
		workspaceId: WS,
		model: toWireModel(faux.getModel()),
		modelOptional: true,
	});
	return created.sessionId;
}

function committedItem(sessionId: string, title = "step"): string {
	return new TodoStore(worktree, sessionId).add({
		title,
		artifacts: [{ kind: "commit", sha: "sha1", label: "a" }],
	}).id;
}

async function settle(sessionId: string, itemId: string): Promise<void> {
	const deadline = Date.now() + 10_000;
	while (itemReviewActive(sessionId, itemId)) {
		if (Date.now() > deadline) throw new Error("plan review never settled");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

test("an approve verdict settles the step as reviewed by the agent", async () => {
	const sessionId = await workerSession();
	const id = committedItem(sessionId);

	expect(startPlanReview(WS, sessionId, id, verdictRunner(approve))).toBe(true);
	await settle(sessionId, id);

	const record = todoReviewRecord({ workspaceId: WS, sessionId, id });
	expect(record?.state).toBe("reviewed");
	expect(record?.reviewedBy).toBe("agent");
});

test("request_changes with auto-fix on files the findings AND delivers the fix to the worker chat", async () => {
	const sessionId = await workerSession();
	const id = committedItem(sessionId);

	startPlanReview(WS, sessionId, id, verdictRunner(requestChanges));
	await settle(sessionId, id);

	const ref = { workspaceId: WS, sessionId, id };
	expect(todoReviewRecord(ref)?.state).toBe("changes_requested");
	// One cycle spent, not two: the worker was actually asked to fix, so the item is mid-auto-cycle.
	expect(todoReviewAutoCycles(ref)).toBe(1);
	const comments = (await getReviewSnapshot(WS)).comments.filter(
		(c) => c.origin?.todoId === id && c.author === "agent",
	);
	expect(comments).toHaveLength(1);
	// `sent` is the delivery proof: a rejected send rolls the finding back to `draft`.
	expect(comments[0]?.status).toBe("sent");
	expect(comments[0]?.body).toContain("loop bound is wrong");
});

test("request_changes with auto-fix OFF files the findings but sends nothing — the user decides", async () => {
	updateConfig({ reviewAutoFix: false });
	const sessionId = await workerSession();
	const id = committedItem(sessionId);

	startPlanReview(WS, sessionId, id, verdictRunner(requestChanges));
	await settle(sessionId, id);

	const ref = { workspaceId: WS, sessionId, id };
	expect(todoReviewAutoCycles(ref)).toBe(2);
	const comments = (await getReviewSnapshot(WS)).comments.filter((c) => c.origin?.todoId === id);
	expect(comments[0]?.status).toBe("draft");
});

test("a second request_changes on the same step is terminal — the 1-cycle cap stops the fix loop", async () => {
	const sessionId = await workerSession();
	const id = committedItem(sessionId);
	const ref = { workspaceId: WS, sessionId, id };

	startPlanReview(WS, sessionId, id, verdictRunner(requestChanges));
	await settle(sessionId, id);
	expect(todoReviewAutoCycles(ref)).toBe(1);

	startPlanReview(WS, sessionId, id, verdictRunner(requestChanges));
	await settle(sessionId, id);
	expect(todoReviewAutoCycles(ref)).toBe(2);
});

test("reviews of one plan run one at a time, and a step already under review is rejected", async () => {
	const sessionId = await workerSession();
	const first = committedItem(sessionId, "one");
	const second = committedItem(sessionId, "two");

	let running = 0;
	let overlapped = false;
	const serialRunner: ReviewRunner = async () => {
		running += 1;
		if (running > 1) overlapped = true;
		await new Promise((resolve) => setTimeout(resolve, 30));
		running -= 1;
		return { childSessionId: "child", status: "completed" as const, finalText: approve };
	};

	expect(startPlanReview(WS, sessionId, first, serialRunner)).toBe(true);
	expect(startPlanReview(WS, sessionId, second, serialRunner)).toBe(true);
	expect(startPlanReview(WS, sessionId, first, serialRunner)).toBe(false);

	await settle(sessionId, first);
	await settle(sessionId, second);
	expect(overlapped).toBe(false);
});

test("a subagent that returns no parsable verdict clears the reviewing mark instead of stranding it", async () => {
	const sessionId = await workerSession();
	const id = committedItem(sessionId);

	startPlanReview(WS, sessionId, id, verdictRunner("I could not decide."));
	await settle(sessionId, id);

	expect(todoReviewRecord({ workspaceId: WS, sessionId, id })).toBeUndefined();
	expect(itemReviewActive(sessionId, id)).toBe(false);
});

test("a fix the worker never accepted gives the auto cycle back instead of stranding the step", async () => {
	// No session exists for this id, so the structured fix send rejects before the worker's turn.
	const sessionId = "sess-detached";
	const id = committedItem(sessionId);
	const ref = { workspaceId: WS, sessionId, id };

	startPlanReview(WS, sessionId, id, verdictRunner(requestChanges));
	await settle(sessionId, id);

	expect(todoReviewRecord(ref)?.state).toBe("changes_requested");
	// Terminal, not mid-cycle: nothing asked the worker to change anything, so no fresh delta will ever
	// reach maybeAutoReReview — recording cycle 1 here would strand the step forever.
	expect(todoReviewAutoCycles(ref)).toBe(2);
	// The findings are back to draft, so a later manual Ask-to-fix still carries them.
	const comments = (await getReviewSnapshot(WS)).comments.filter((c) => c.origin?.todoId === id);
	expect(comments).toHaveLength(1);
	expect(comments[0]?.status).toBe("draft");
	expect(isItemUnderActiveReview(sessionId, id)).toBe(false);
});

test("a fix landing during another step's review is re-reviewed, not dropped", async () => {
	const sessionId = await workerSession();
	const a = committedItem(sessionId, "A");
	const b = committedItem(sessionId, "B");
	const refA = { workspaceId: WS, sessionId, id: a };

	// Round 1 on A: request_changes with auto-fix on → changes_requested, autoCycles 1, finding sent.
	startPlanReview(WS, sessionId, a, verdictRunner(requestChanges));
	await settle(sessionId, a);
	expect(todoReviewAutoCycles(refA)).toBe(1);

	// The worker "fixes" A: a fresh commit lands (unreviewed delta) and A is marked done.
	new TodoStore(worktree, sessionId).update(a, {
		status: "done",
		artifacts: [
			{ kind: "commit", sha: "sha1", label: "a" },
			{ kind: "commit", sha: "sha2", label: "fix" },
		],
	});

	// A slow review of B occupies the plan's serial chain.
	let releaseB!: () => void;
	const bGate = new Promise<void>((resolve) => {
		releaseB = resolve;
	});
	const slowRunner: ReviewRunner = async () => {
		await bGate;
		return { childSessionId: "child", status: "completed" as const, finalText: approve };
	};
	expect(startPlanReview(WS, sessionId, b, slowRunner)).toBe(true);

	// The fix's tool-end fires while B is mid-review — A must be enqueued onto the busy chain, not dropped.
	let reviewedA = false;
	await maybeAutoReReview(
		WS,
		sessionId,
		verdictRunner(approve, () => {
			reviewedA = true;
		}),
	);
	expect(itemReviewActive(sessionId, a)).toBe(true);

	releaseB();
	await settle(sessionId, b);
	await settle(sessionId, a);
	expect(reviewedA).toBe(true);
});

test("a tool request_review queues behind a button review of another step on the same plan", async () => {
	const sessionId = await workerSession();
	const first = committedItem(sessionId, "one");
	const second = committedItem(sessionId, "two");

	let running = 0;
	let overlapped = false;
	const serialRunner: ReviewRunner = async () => {
		running += 1;
		if (running > 1) overlapped = true;
		await new Promise((resolve) => setTimeout(resolve, 30));
		running -= 1;
		return { childSessionId: "child", status: "completed" as const, finalText: approve };
	};

	installRequestReviewSeam(serialRunner);
	const ctx = { sessionManager: { getSessionId: () => sessionId } } as unknown as ExtensionContext;

	// Button review on `first` and the worker's request_review tool on `second`, kicked off together:
	// without the shared plan chain both hidden children would stream at once.
	expect(startPlanReview(WS, sessionId, first, serialRunner)).toBe(true);
	await createRequestReviewTool().execute(
		"tc",
		{ itemId: second } as never,
		undefined,
		undefined,
		ctx,
	);
	await settle(sessionId, first);
	await settle(sessionId, second);

	expect(overlapped).toBe(false);
});

test("a fix whose preparation fails gives the auto cycle back instead of stranding the step", async () => {
	const sessionId = await workerSession();
	const id = committedItem(sessionId);
	const ref = { workspaceId: WS, sessionId, id };

	// The reviewer requests changes and the fix reaches delivery, but building the send package throws
	// (a disk/render fault) BEFORE the send — the failure must not escape as a throw and strand cycle 1.
	const spy = spyOn(reviews, "buildSendPackage").mockImplementation(async () => {
		throw new Error("package render failed");
	});
	try {
		startPlanReview(WS, sessionId, id, verdictRunner(requestChanges));
		await settle(sessionId, id);
	} finally {
		spy.mockRestore();
	}

	expect(todoReviewRecord(ref)?.state).toBe("changes_requested");
	// Terminal, not mid-cycle: no fix reached the worker, so nothing will ever produce the delta
	// maybeAutoReReview waits for — recording cycle 1 here would strand the step forever.
	expect(todoReviewAutoCycles(ref)).toBe(2);
	// A marked finding was rolled back to draft (here none had been marked yet, but the invariant holds).
	const comments = (await getReviewSnapshot(WS)).comments.filter((c) => c.origin?.todoId === id);
	expect(comments).toHaveLength(1);
	expect(comments[0]?.status).toBe("draft");
	expect(isItemUnderActiveReview(sessionId, id)).toBe(false);
});

test("a finding whose store write fails cancels the review instead of spending the cycle", async () => {
	const sessionId = await workerSession();
	const id = committedItem(sessionId);
	const ref = { workspaceId: WS, sessionId, id };

	// The reviewer requests changes, but persisting the finding throws (the review store is unwritable).
	// A persistence failure must not be swallowed as a bad anchor: no finding, no consumed cycle, no
	// stranded step — the review is cancelled so the reviewing mark clears.
	const spy = spyOn(reviews, "addComment").mockImplementation(async () => {
		throw new Error("review store unwritable");
	});
	try {
		startPlanReview(WS, sessionId, id, verdictRunner(requestChanges));
		await settle(sessionId, id);
	} finally {
		spy.mockRestore();
	}

	expect(todoReviewRecord(ref)).toBeUndefined();
	expect(todoReviewAutoCycles(ref)).toBeUndefined();
	expect(
		(await getReviewSnapshot(WS)).comments.filter((c) => c.origin?.todoId === id),
	).toHaveLength(0);
	expect(itemReviewActive(sessionId, id)).toBe(false);
});

test("a re-review approve does NOT settle the step while an earlier finding is still open", async () => {
	const sessionId = await workerSession();
	const id = committedItem(sessionId);
	const ref = { workspaceId: WS, sessionId, id };

	// Round 1: a finding is filed and delivered to the worker (status `sent`).
	startPlanReview(WS, sessionId, id, verdictRunner(requestChanges));
	await settle(sessionId, id);
	const sent = (await getReviewSnapshot(WS)).comments.find((c) => c.origin?.todoId === id);
	expect(sent?.status).toBe("sent");

	// Round 2: the worker changed the code but never resolved the finding, and the reviewer approves.
	startPlanReview(WS, sessionId, id, verdictRunner(approve));
	await settle(sessionId, id);

	// The plan must not read ready-to-ship over a finding the Review panel still shows as open.
	expect(todoReviewRecord(ref)?.state).not.toBe("reviewed");
	expect((await getReviewSnapshot(WS)).comments.find((c) => c.id === sent?.id)?.status).toBe(
		"sent",
	);
	// The spinner is cleared either way — an unsettled approve is not an in-flight review.
	expect(itemReviewActive(sessionId, id)).toBe(false);
});

test("an unset reviewer model resolves the user's default, not the worker's inherited model", async () => {
	const agentDir = process.env.PI_CODING_AGENT_DIR;
	if (!agentDir) throw new Error("agent dir not isolated");
	const settingsPath = join(agentDir, "settings.json");
	writeFileSync(
		settingsPath,
		`${JSON.stringify({ defaultProvider: "faux-worker", defaultModel: "faux-worker-model" })}\n`,
	);
	const sessionId = await workerSession();
	const id = committedItem(sessionId);
	let captured: { provider: string; id: string } | undefined;
	const capturingRunner: ReviewRunner = async (_ws, _sess, _task, role) => {
		captured = role.model;
		return { childSessionId: "child", status: "completed" as const, finalText: approve };
	};
	try {
		startPlanReview(WS, sessionId, id, capturingRunner);
		await settle(sessionId, id);
	} finally {
		rmSync(settingsPath, { force: true });
	}
	expect(captured).toEqual({ provider: "faux-worker", id: "faux-worker-model" });
});

test("the tool path awaits artifact reconciliation before it snapshots the change set", async () => {
	installRequestReviewSeam(verdictRunner(approve));
	const sessionId = await workerSession();
	const id = committedItem(sessionId);
	const ctx = { sessionManager: { getSessionId: () => sessionId } } as unknown as ExtensionContext;

	// The reviewing snapshot must be taken only after the reconciliation barrier settles — request_review
	// fires right after todo_update, so a snapshot before the barrier can miss the just-committed change set.
	const order: string[] = [];
	const realStart = todos.startTodoReview;
	const settleSpy = spyOn(todos, "settleChangeArtifacts").mockImplementation(async () => {
		order.push("settle");
	});
	const startSpy = spyOn(todos, "startTodoReview").mockImplementation((p) => {
		order.push("start");
		return realStart(p);
	});
	try {
		await createRequestReviewTool().execute(
			"tc",
			{ itemId: id } as never,
			undefined,
			undefined,
			ctx,
		);
	} finally {
		settleSpy.mockRestore();
		startSpy.mockRestore();
	}

	expect(order[0]).toBe("settle");
	expect(order.indexOf("settle")).toBeLessThan(order.indexOf("start"));
	expect(todoReviewRecord({ workspaceId: WS, sessionId, id })?.state).toBe("reviewed");
});

test("the tool path marks findings sent to the worker so resolve_comment can close them", async () => {
	installRequestReviewSeam(verdictRunner(requestChanges));
	const sessionId = await workerSession();
	const id = committedItem(sessionId);
	const ctx = { sessionManager: { getSessionId: () => sessionId } } as unknown as ExtensionContext;
	const out = await createRequestReviewTool().execute(
		"tc",
		{ itemId: id } as never,
		undefined,
		undefined,
		ctx,
	);

	const comment = (await getReviewSnapshot(WS)).comments.find((c) => c.origin?.todoId === id);
	expect(comment?.status).toBe("sent");
	expect(comment?.sessionId).toBe(sessionId);
	const cid = comment?.id ?? "";
	expect(cid).toMatch(/^rc_/);
	// The worker-facing text names the canonical id, not the model's transient f1.
	const text = String((out.content?.[0] as { text?: string } | undefined)?.text ?? "");
	expect(text).toContain(cid);
	expect(text).not.toContain("[f1]");
	// resolve_comment closes it by canonical id — the re-review approve gate is now satisfiable.
	expect(() => reviews.resolveCommentFromAgent(sessionId, cid)).not.toThrow();
	expect((await getReviewSnapshot(WS)).comments.find((c) => c.id === cid)?.status).toBe("resolved");
});

test("a request_review that fails before the review starts releases its claim, so the retry runs", async () => {
	installRequestReviewSeam(verdictRunner(approve));
	const sessionId = await workerSession();
	// No change set yet: startTodoReview throws, and the claim must not outlive the failed call.
	const id = new TodoStore(worktree, sessionId).add({ title: "not yet committed" }).id;
	const ctx = { sessionManager: { getSessionId: () => sessionId } } as unknown as ExtensionContext;
	const run = () =>
		createRequestReviewTool().execute("tc", { itemId: id } as never, undefined, undefined, ctx);

	await expect(run()).rejects.toThrow(/no change set/);
	expect(itemReviewActive(sessionId, id)).toBe(false);

	// The step becomes reviewable; the retry must reach the reviewer, not "already being reviewed".
	new TodoStore(worktree, sessionId).update(id, {
		artifacts: [{ kind: "commit", sha: "sha1", label: "a" }],
	});
	await expect(run()).resolves.toBeDefined();
	expect(todoReviewRecord({ workspaceId: WS, sessionId, id })?.state).toBe("reviewed");
});

test("only actual agent verdicts emit review decisions, and never leak plan content", async () => {
	const events: { event: string; properties: Record<string, unknown> }[] = [];
	initializeAnalytics({
		additionalEnabled: true,
		env: {},
		fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
			events.push(...JSON.parse(String(init?.body)).batch);
			return new Response("{}", { status: 200 });
		}) as typeof fetch,
	});
	try {
		updateConfig({ reviewAutoFix: false });
		const sessionId = await workerSession();
		for (const finalText of [approve, requestChanges, "no verdict here"]) {
			const id = committedItem(sessionId, "private task");
			startPlanReview(WS, sessionId, id, verdictRunner(finalText));
			await settle(sessionId, id);
		}
		await shutdownAnalytics();
		expect(
			events
				.filter((event) => event.event === "review_decided")
				.map((event) => [event.properties.actor, event.properties.verdict]),
		).toEqual([
			["agent", "approved"],
			["agent", "changes_requested"],
		]);
		expect(JSON.stringify(events)).not.toContain("private");
	} finally {
		await shutdownAnalytics();
		resetAnalyticsForTests();
	}
});
