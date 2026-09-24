import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import {
	type ExtensionContext,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ReviewFailedPayload, Workspace } from "@thinkrail/contracts";
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
	itemTitleOf,
	maybeAutoReReview,
	type ReviewRunner,
	setReviewFailedPublisher,
	startPlanReview,
} from "./requestReview";
import { withReviewLock } from "./reviewLock";
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

function sh(cwd: string, ...args: string[]): void {
	const r = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!r.success) throw new Error(`git ${args.join(" ")} failed`);
}

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

test("integration: a real reviewer child requests changes, the fix resolves, and re-review approves", async () => {
	const agentDir = process.env.PI_CODING_AGENT_DIR;
	if (!agentDir) throw new Error("agent dir not isolated");
	const settingsPath = join(agentDir, "settings.json");
	writeFileSync(
		settingsPath,
		`${JSON.stringify({ defaultProvider: "faux-worker", defaultModel: "faux-worker-model" })}\n`,
	);
	const sessionId = await workerSession();
	const id = committedItem(sessionId, "real-child step");
	const ref = { workspaceId: WS, sessionId, id };
	try {
		// Round 1: the REAL delegated reviewer (default runner → runReviewSubagent, faux model) requests changes.
		faux.setResponses([fauxAssistantMessage(requestChanges)]);
		expect(startPlanReview(WS, sessionId, id)).toBe(true);
		await settle(sessionId, id);

		expect(todoReviewRecord(ref)?.state).toBe("changes_requested");
		const finding = (await getReviewSnapshot(WS)).comments.find((c) => c.origin?.todoId === id);
		expect(finding?.status).toBe("sent");
		expect(finding?.sessionId).toBe(sessionId);
		expect(finding?.body).toContain("loop bound is wrong");

		// The worker resolves the delivered finding by its canonical id.
		reviews.resolveCommentFromAgent(sessionId, finding?.id ?? "");

		// Round 2: the real reviewer approves; with the finding resolved, the step settles reviewed.
		faux.setResponses([fauxAssistantMessage(approve)]);
		expect(startPlanReview(WS, sessionId, id)).toBe(true);
		await settle(sessionId, id);

		expect(todoReviewRecord(ref)?.state).toBe("reviewed");
		expect(todoReviewRecord(ref)?.reviewedBy).toBe("agent");
	} finally {
		rmSync(settingsPath, { force: true });
	}
});

test("a post-ack review failure publishes an actionable UI error, not just a warning", async () => {
	const sessionId = await workerSession();
	const id = committedItem(sessionId, "flaky step");
	const failures: ReviewFailedPayload[] = [];
	setReviewFailedPublisher((p) => failures.push(p));
	try {
		startPlanReview(WS, sessionId, id, verdictRunner("no parsable verdict here"));
		await settle(sessionId, id);
	} finally {
		setReviewFailedPublisher(() => {});
	}
	expect(failures).toHaveLength(1);
	expect(failures[0]?.workspaceId).toBe(WS);
	expect(failures[0]?.sessionId).toBe(sessionId);
	expect(failures[0]?.itemId).toBe(id);
	expect(failures[0]?.itemTitle).toBe("flaky step");
	expect(failures[0]?.message).toMatch(/valid verdict/);
	// The spinner is cleared, not stranded on a failure with no toast.
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

test("an unset reviewer effort resolves the user's default, not the worker's inherited effort", async () => {
	const agentDir = process.env.PI_CODING_AGENT_DIR;
	if (!agentDir) throw new Error("agent dir not isolated");
	const settingsPath = join(agentDir, "settings.json");
	// No pinned reviewEffort; the user's default thinking level is "high", while the worker session runs
	// on the faux model at its own effort. The reviewer must run at the resolved default, never inherit.
	writeFileSync(settingsPath, `${JSON.stringify({ defaultThinkingLevel: "high" })}\n`);
	const sessionId = await workerSession();
	const id = committedItem(sessionId);
	let captured: string | undefined;
	const capturingRunner: ReviewRunner = async (_ws, _sess, _task, role) => {
		captured = role.thinkingLevel;
		return { childSessionId: "child", status: "completed" as const, finalText: approve };
	};
	try {
		startPlanReview(WS, sessionId, id, capturingRunner);
		await settle(sessionId, id);
	} finally {
		rmSync(settingsPath, { force: true });
	}
	expect(captured).toBe("high");
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

test("the tool path deletes the just-filed drafts when the mark-sent transaction fails", async () => {
	installRequestReviewSeam(verdictRunner(requestChanges));
	const sessionId = await workerSession();
	const id = committedItem(sessionId);
	const ref = { workspaceId: WS, sessionId, id };
	const ctx = { sessionManager: { getSessionId: () => sessionId } } as unknown as ExtensionContext;

	// Filing succeeds but the mark-sent step throws (a concurrent clear / non-draft collision). The
	// compensation must remove the just-filed drafts so no open finding is stranded whose canonical id
	// the worker never received, and the request must reject rather than spend the cycle.
	const spy = spyOn(reviews, "markCommentsSent").mockImplementation(async () => {
		throw new Error("review store unwritable");
	});
	try {
		await expect(
			createRequestReviewTool().execute("tc", { itemId: id } as never, undefined, undefined, ctx),
		).rejects.toThrow(/review store unwritable/);
	} finally {
		spy.mockRestore();
	}

	expect(
		(await getReviewSnapshot(WS)).comments.filter((c) => c.origin?.todoId === id),
	).toHaveLength(0);
	expect(todoReviewRecord(ref)).toBeUndefined();
	expect(todoReviewAutoCycles(ref)).toBeUndefined();
	expect(itemReviewActive(sessionId, id)).toBe(false);
});

const requestChangesTwo = [
	"```json",
	'{ "verdict": "request_changes", "summary": "two problems",',
	'  "findings": [ { "id": "f1", "path": "a.ts", "startLine": 1, "body": "first" },',
	'               { "id": "f2", "path": "a.ts", "startLine": 2, "body": "second" } ] }',
	"```",
].join("\n");

test("the tool path deletes the first filed draft when a later finding fails to persist", async () => {
	installRequestReviewSeam(verdictRunner(requestChangesTwo));
	const sessionId = await workerSession();
	const id = committedItem(sessionId);
	const ref = { workspaceId: WS, sessionId, id };
	const ctx = { sessionManager: { getSessionId: () => sessionId } } as unknown as ExtensionContext;

	// The first finding persists; the second addComment throws (a mid-loop store fault). fileFindings
	// must compensate its own partial success so the first draft is deleted, leaving no stranded open
	// finding whose canonical id the worker never received, and the request must reject.
	const real = reviews.addComment;
	let calls = 0;
	const spy = spyOn(reviews, "addComment").mockImplementation(async (arg) => {
		calls += 1;
		if (calls === 2) throw new Error("review store unwritable");
		return real(arg);
	});
	try {
		await expect(
			createRequestReviewTool().execute("tc", { itemId: id } as never, undefined, undefined, ctx),
		).rejects.toThrow(/review store unwritable/);
	} finally {
		spy.mockRestore();
	}

	expect(
		(await getReviewSnapshot(WS)).comments.filter((c) => c.origin?.todoId === id),
	).toHaveLength(0);
	expect(todoReviewRecord(ref)).toBeUndefined();
	expect(todoReviewAutoCycles(ref)).toBeUndefined();
	expect(itemReviewActive(sessionId, id)).toBe(false);
});

test("the button path files under the review lock, so an interleaved send cannot strand a finding", async () => {
	const sessionId = await workerSession();
	const id = committedItem(sessionId);
	const ref = { workspaceId: WS, sessionId, id };

	// Button path (deliverFix), two findings. The first persists; a concurrent Review "Send" then races
	// in to mark it `sent`, and the second write fails. With filing under withReviewLock the send is
	// serialized AFTER filing + compensation, so cleanup deletes the still-draft first finding and the
	// send finds nothing to mark — no open finding survives with an id the worker never received.
	const real = reviews.addComment;
	let firstId = "";
	let sendDone: Promise<unknown> = Promise.resolve();
	let calls = 0;
	const spy = spyOn(reviews, "addComment").mockImplementation(async (arg) => {
		calls += 1;
		if (calls === 1) {
			const c = await real(arg);
			firstId = c.id;
			return c;
		}
		sendDone = withReviewLock(WS, () => reviews.markCommentsSent(WS, [firstId], sessionId)).catch(
			() => {},
		);
		throw new Error("review store unwritable");
	});
	try {
		startPlanReview(WS, sessionId, id, verdictRunner(requestChangesTwo));
		await settle(sessionId, id);
	} finally {
		spy.mockRestore();
	}
	await sendDone;

	expect(
		(await getReviewSnapshot(WS)).comments.filter((c) => c.origin?.todoId === id),
	).toHaveLength(0);
	expect(todoReviewRecord(ref)).toBeUndefined();
	expect(itemReviewActive(sessionId, id)).toBe(false);
});

test("the button path delivers canonical ids even when a Review send races before worker delivery", async () => {
	const sessionId = await workerSession();
	const id = committedItem(sessionId);
	const ref = { workspaceId: WS, sessionId, id };

	// `sent` captures the comments each worker package was built from — canonical rc_ ids. It stays empty
	// if a racing send marked the drafts `sent` first, since delivery would then find no drafts to package.
	const sent: { id: string }[] = [];
	const realBuild = reviews.buildSendPackage;
	const buildSpy = spyOn(reviews, "buildSendPackage").mockImplementation(async (ws, comments) => {
		sent.push(...comments);
		return realBuild(ws, comments);
	});
	// The instant the finding is filed, a concurrent Review "Send" races to mark it `sent`. Filing +
	// selection + mark-sent now share one review lock, so this send is serialized AFTER delivery selects
	// the still-draft finding — the worker receives the canonical id, not a generic request.
	const realAdd = reviews.addComment;
	let raced: Promise<unknown> = Promise.resolve();
	let racedOnce = false;
	const addSpy = spyOn(reviews, "addComment").mockImplementation(async (arg) => {
		const c = await realAdd(arg);
		if (!racedOnce) {
			racedOnce = true;
			raced = withReviewLock(WS, () => reviews.markCommentsSent(WS, [c.id], "sess-other")).catch(
				() => {},
			);
		}
		return c;
	});
	try {
		startPlanReview(WS, sessionId, id, verdictRunner(requestChanges));
		await settle(sessionId, id);
	} finally {
		addSpy.mockRestore();
		buildSpy.mockRestore();
	}
	await raced;

	expect(sent).toHaveLength(1);
	expect(sent[0]?.id).toMatch(/^rc_/);
	// Delivery landed on its first cycle; the finding was reserved to the worker, not the racer.
	expect(todoReviewRecord(ref)?.state).toBe("changes_requested");
	expect(todoReviewAutoCycles(ref)).toBe(1);
	expect((await getReviewSnapshot(WS)).comments.find((c) => c.origin?.todoId === id)?.status).toBe(
		"sent",
	);
});

test("the tool path rolls back and deletes the findings when the cycle record fails", async () => {
	installRequestReviewSeam(verdictRunner(requestChanges));
	const sessionId = await workerSession();
	const id = committedItem(sessionId);
	const ref = { workspaceId: WS, sessionId, id };
	const ctx = { sessionManager: { getSessionId: () => sessionId } } as unknown as ExtensionContext;

	// Findings file and mark `sent`, then the todo-review sidecar write throws. The transaction must roll
	// the sent findings back to draft and delete them so the cancelled review leaves nothing open whose
	// canonical id the worker never received, and the request must reject without spending the cycle.
	const spy = spyOn(todos, "recordAgentChangesRequested").mockImplementation(() => {
		throw new Error("sidecar rename failed");
	});
	try {
		await expect(
			createRequestReviewTool().execute("tc", { itemId: id } as never, undefined, undefined, ctx),
		).rejects.toThrow(/sidecar rename failed/);
	} finally {
		spy.mockRestore();
	}

	expect(
		(await getReviewSnapshot(WS)).comments.filter((c) => c.origin?.todoId === id),
	).toHaveLength(0);
	expect(todoReviewRecord(ref)).toBeUndefined();
	expect(todoReviewAutoCycles(ref)).toBeUndefined();
	expect(itemReviewActive(sessionId, id)).toBe(false);
});

test("the button path deletes the filed drafts when the cycle record fails", async () => {
	const sessionId = await workerSession();
	const id = committedItem(sessionId);
	const ref = { workspaceId: WS, sessionId, id };

	// Filing succeeds, then record(1) throws before any mark. The just-filed drafts must be deleted so the
	// cancelled review leaves nothing open, and no cycle is recorded.
	const spy = spyOn(todos, "recordAgentChangesRequested").mockImplementation(() => {
		throw new Error("sidecar rename failed");
	});
	try {
		startPlanReview(WS, sessionId, id, verdictRunner(requestChanges));
		await settle(sessionId, id);
	} finally {
		spy.mockRestore();
	}

	expect(
		(await getReviewSnapshot(WS)).comments.filter((c) => c.origin?.todoId === id),
	).toHaveLength(0);
	expect(todoReviewRecord(ref)).toBeUndefined();
	expect(todoReviewAutoCycles(ref)).toBeUndefined();
	expect(isItemUnderActiveReview(sessionId, id)).toBe(false);
});

test("the auto-fix-off path deletes the filed drafts when the cycle record fails", async () => {
	updateConfig({ reviewAutoFix: false });
	const sessionId = await workerSession();
	const id = committedItem(sessionId);
	const ref = { workspaceId: WS, sessionId, id };

	const spy = spyOn(todos, "recordAgentChangesRequested").mockImplementation(() => {
		throw new Error("sidecar rename failed");
	});
	try {
		startPlanReview(WS, sessionId, id, verdictRunner(requestChanges));
		await settle(sessionId, id);
	} finally {
		spy.mockRestore();
	}

	expect(
		(await getReviewSnapshot(WS)).comments.filter((c) => c.origin?.todoId === id),
	).toHaveLength(0);
	expect(todoReviewRecord(ref)).toBeUndefined();
	expect(itemReviewActive(sessionId, id)).toBe(false);
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

test("itemTitleOf labels a Review-All adopted commit with its subject, not the commit:<sha> id", async () => {
	// A commit no plan item owns is surfaced only as a wire-only adoptedCommits entry; the review result
	// card / detached-failure toast must name its subject, so itemTitleOf has to look there too.
	const wt = mkdtempSync(join(tmpdir(), "planreview-adopt-"));
	const ws = "ws-adopt";
	sh(wt, "init", "-b", "main");
	sh(wt, "config", "user.email", "t@thinkrail.test");
	sh(wt, "config", "user.name", "test");
	sh(wt, "config", "commit.gpgsign", "false");
	writeFileSync(join(wt, "README.md"), "# repo\n");
	sh(wt, "add", "-A");
	sh(wt, "commit", "-m", "init");
	sh(wt, "checkout", "-b", "feature");
	writeFileSync(join(wt, "loose.ts"), "export const a = 1;\n");
	sh(wt, "add", "-A");
	sh(wt, "commit", "-m", "feat: loose work");
	const sha = Bun.spawnSync(["git", "-C", wt, "rev-parse", "HEAD"]).stdout.toString().trim();
	saveWorkspaces([
		{
			id: ws,
			projectId: "p1",
			name: "w",
			branch: "feature",
			baseBranch: "main",
			worktreePath: wt,
			createdAt: 0,
		} as Workspace,
	]);
	try {
		expect(await itemTitleOf(ws, "sess-adopt", `commit:${sha}`)).toBe("feat: loose work");
		expect(await itemTitleOf(ws, "sess-adopt", "commit:deadbeef")).toBe("commit:deadbeef");
	} finally {
		rmSync(wt, { recursive: true, force: true });
	}
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
