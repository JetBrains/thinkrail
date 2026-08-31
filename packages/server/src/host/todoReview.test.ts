import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
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
import type { ReviewAnchor, Workspace } from "@thinkrail/contracts";
import { TodoStore } from "pi-todos/core";
import {
	abortSession,
	configurePiRuntime,
	disposeAllSessions,
	isSessionStreaming,
	listSessions,
	removeSession,
	setSessionManagerFactory,
	setSessionPublisher,
	toWireModel,
} from "../agent";
import {
	createAddReviewCommentTool,
	createReflectFindingTool,
	createReviewVerdictTool,
} from "../agent/reviewTool";
import { saveProjects, saveWorkspaces } from "../persistence";
import {
	addComment,
	getReviewSnapshot,
	markCommentsSent,
	resolveCommentFromAgent,
} from "../reviews";
import { resetConfigCache, updateConfig } from "../settings";
import {
	readReviewMeta,
	reviewerSessionFor,
	startTodoReview,
	todoReviewAutoCycles,
} from "../todos";
import {
	claimItemFix,
	handleReviewerSettled,
	installTodoReviewSeams,
	isItemUnderActiveReview,
	itemFixFindings,
	itemOpenFindings,
	maybeResumeReflection,
	reconcilePendingReviewsOnBoot,
	releaseItemFix,
	startReviewAllFlow,
	startTodoReviewFlow,
} from "./todoReview";

let dataDir: string;
let worktree: string;
const WS = "ws-fixfindings";
const SESSION = "sess-fixfindings";

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "fixfind-data-"));
	worktree = mkdtempSync(join(tmpdir(), "fixfind-wt-"));
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

// --- A real (faux-model) reviewer session, so the add_review_comment tool seam can be driven the same
// way a live reviewer chat would — see agentSessionManager.test.ts for the same harness pattern.
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

const fauxReviewer = createFauxCore({
	provider: "faux-reviewer",
	api: "faux-reviewer",
	models: [modelDef("faux-reviewer-model")],
	tokensPerSecond: 2000,
});

let priorAgentDir: string | undefined;
let priorOffline: string | undefined;
let runtime: ModelRuntime;

beforeAll(async () => {
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "trpi-review-agentdir-"));
	priorOffline = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";

	runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("faux-reviewer", {
		api: fauxReviewer.api,
		baseUrl: "http://faux-reviewer.local",
		apiKey: "faux",
		streamSimple: fauxReviewer.streamSimple,
		models: [{ ...modelDef("faux-reviewer-model"), api: fauxReviewer.api }],
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

const reviewerCtx = (sessionId: string): ExtensionContext =>
	({ sessionManager: { getSessionId: () => sessionId } }) as unknown as ExtensionContext;

function anchorAt(path: string): ReviewAnchor {
	return {
		path,
		side: "worktree",
		contentHash: "",
		selectors: [{ kind: "lineRange", startLine: 1, endLine: 1 }],
	};
}

test("the per-item fix latch rejects overlap and participates in the removal guard", () => {
	expect(claimItemFix(SESSION, "t1")).toBe(true);
	try {
		expect(claimItemFix(SESSION, "t1")).toBe(false);
		expect(isItemUnderActiveReview(SESSION, "t1")).toBe(true);
	} finally {
		releaseItemFix(SESSION, "t1");
	}
	expect(isItemUnderActiveReview(SESSION, "t1")).toBe(false);
});

test("itemFixFindings keeps only this item's open unstale agent findings", async () => {
	const todo = new TodoStore(worktree, SESSION).add({
		title: "t",
		artifacts: [
			{ kind: "commit", sha: "sha1", label: "a" },
			{ kind: "commit", sha: "sha2", label: "b" },
		],
	});
	const origin = { todoId: todo.id, sessionId: SESSION, reviewedSha: "sha2" };
	const finding = (over: Partial<Parameters<typeof addComment>[0]>) =>
		addComment({
			workspaceId: WS,
			kind: "inline",
			author: "agent",
			anchor: anchorAt("a.ts"),
			body: "finding",
			origin,
			...over,
		});

	const kept = await finding({});
	await finding({ origin: { ...origin, todoId: "other-item" } });
	await finding({ origin: { ...origin, sessionId: "other-session" } });
	await addComment({
		workspaceId: WS,
		kind: "inline",
		anchor: anchorAt("a.ts"),
		body: "human draft",
	});
	const sent = await finding({});
	await markCommentsSent(WS, [sent.id], SESSION);
	await finding({ anchor: anchorAt("gone.ts"), origin: { ...origin, reviewedSha: "sha1" } });

	const ids = (await itemFixFindings({ workspaceId: WS, sessionId: SESSION, id: todo.id })).map(
		(c) => c.id,
	);
	expect(ids).toEqual([kept.id]);
});

test("a concurrent reviewer finding lands before an approval checks for open findings", async () => {
	installTodoReviewSeams();
	fauxReviewer.setResponses([fauxAssistantMessage("Looks fine, no findings.")]);
	updateConfig({ reviewModel: toWireModel(fauxReviewer.getModel()), reviewEffort: "medium" });
	const todo = new TodoStore(worktree, SESSION).add({
		title: "t",
		artifacts: [{ kind: "commit", sha: "sha1", label: "a" }],
	});
	const { reviewerSessionId } = await startTodoReviewFlow({
		workspaceId: WS,
		sessionId: SESSION,
		id: todo.id,
	});
	const finding = createAddReviewCommentTool().execute(
		"tc-concurrent-finding",
		{ path: "a.ts", startLine: 1, body: "concurrent finding" } as never,
		undefined,
		undefined,
		reviewerCtx(reviewerSessionId),
	);
	const verdict = createReviewVerdictTool().execute(
		"tc-concurrent-verdict",
		{ todoId: todo.id, verdict: "approve" } as never,
		undefined,
		undefined,
		reviewerCtx(reviewerSessionId),
	);

	expect((await Promise.allSettled([finding, verdict])).map((result) => result.status)).toEqual([
		"fulfilled",
		"rejected",
	]);
	expect(await itemOpenFindings({ workspaceId: WS, sessionId: SESSION, id: todo.id })).toHaveLength(
		1,
	);
	handleReviewerSettled(reviewerSessionId, { type: "agent_settled", terminal: null });
});

test("review_verdict rejects approve while this item still has an open finding from the same review", async () => {
	installTodoReviewSeams();
	fauxReviewer.setResponses([fauxAssistantMessage("Looks fine, no findings.")]);
	updateConfig({ reviewModel: toWireModel(fauxReviewer.getModel()), reviewEffort: "medium" });

	const todo = new TodoStore(worktree, SESSION).add({
		title: "t",
		artifacts: [{ kind: "commit", sha: "sha1", label: "a" }],
	});

	const { reviewerSessionId } = await startTodoReviewFlow({
		workspaceId: WS,
		sessionId: SESSION,
		id: todo.id,
	});
	const ref = { workspaceId: WS, sessionId: SESSION, id: todo.id };

	// The reviewer files a finding via the real tool seam, then (mistakenly, or a misbehaving model)
	// tries to approve straight over it in the same turn.
	await createAddReviewCommentTool().execute(
		"tc-finding",
		{ path: "a.ts", startLine: 1, body: "this looks wrong" } as never,
		undefined,
		undefined,
		reviewerCtx(reviewerSessionId),
	);
	expect(await itemFixFindings(ref)).toHaveLength(1);

	await expect(
		createReviewVerdictTool().execute(
			"tc-verdict",
			{ todoId: todo.id, verdict: "approve" } as never,
			undefined,
			undefined,
			reviewerCtx(reviewerSessionId),
		),
	).rejects.toThrow(/open finding/);

	// Rejected, not silently recorded: the finding is still there, and the item was never approved —
	// a plan with a blocking comment still open must not read as ready to ship / enable Open PR.
	expect(await itemFixFindings(ref)).toHaveLength(1);

	// A THROWN verdict deliberately leaves the in-flight latch and this session's registration standing
	// (the reviewer is expected to re-issue in the same turn) — settle the turn so the module-level maps
	// this file shares don't leak a live review into the next test.
	handleReviewerSettled(reviewerSessionId, { type: "agent_settled", terminal: null });
});

test("review_verdict rejects approve over a SENT finding too — delivered to the worker is still unresolved", async () => {
	installTodoReviewSeams();
	fauxReviewer.setResponses([fauxAssistantMessage("Looks fine now.")]);
	updateConfig({ reviewModel: toWireModel(fauxReviewer.getModel()), reviewEffort: "medium" });

	const todo = new TodoStore(worktree, SESSION).add({
		title: "t",
		artifacts: [{ kind: "commit", sha: "sha1", label: "a" }],
	});
	const ref = { workspaceId: WS, sessionId: SESSION, id: todo.id };

	// A finding from an EARLIER cycle that already rode a fix request into the worker chat: `sent`, not
	// `draft`. The worker changed the code but never called resolve_comment, so Review still shows it.
	const sentFinding = await addComment({
		workspaceId: WS,
		kind: "inline",
		author: "agent",
		anchor: anchorAt("a.ts"),
		body: "earlier finding, already sent",
		origin: { todoId: todo.id, sessionId: SESSION, reviewedSha: "sha1" },
	});
	await markCommentsSent(WS, [sentFinding.id], SESSION);

	// The draft-only fix filter no longer sees it — which is exactly why gating on that set was wrong.
	expect(await itemFixFindings(ref)).toHaveLength(0);
	// The open-findings gate does.
	expect(await itemOpenFindings(ref)).toHaveLength(1);

	const { reviewerSessionId } = await startTodoReviewFlow({
		workspaceId: WS,
		sessionId: SESSION,
		id: todo.id,
	});

	// The automatic re-review sees clean code and tries to approve — it must not close the item over
	// the still-open sent finding.
	await expect(
		createReviewVerdictTool().execute(
			"tc-verdict-sent",
			{ todoId: todo.id, verdict: "approve" } as never,
			undefined,
			undefined,
			reviewerCtx(reviewerSessionId),
		),
	).rejects.toThrow(/open finding/);

	// Once the finding is actually resolved, the same approve goes through — the gate blocks the
	// override, it does not permanently wedge the item.
	resolveCommentFromAgent(SESSION, sentFinding.id, "fixed in the follow-up commit");
	expect(await itemOpenFindings(ref)).toHaveLength(0);
	await createReviewVerdictTool().execute(
		"tc-verdict-sent-2",
		{ todoId: todo.id, verdict: "approve" } as never,
		undefined,
		undefined,
		reviewerCtx(reviewerSessionId),
	);

	handleReviewerSettled(reviewerSessionId, { type: "agent_settled", terminal: null });
});

test("add_review_comment rejects once the reviewer session has settled — no origin-less comment lands", async () => {
	installTodoReviewSeams();
	fauxReviewer.setResponses([fauxAssistantMessage("Looks fine, no findings.")]);
	updateConfig({ reviewModel: toWireModel(fauxReviewer.getModel()), reviewEffort: "medium" });

	const todo = new TodoStore(worktree, SESSION).add({
		title: "t",
		artifacts: [{ kind: "commit", sha: "sha1", label: "a" }],
	});

	const { reviewerSessionId } = await startTodoReviewFlow({
		workspaceId: WS,
		sessionId: SESSION,
		id: todo.id,
	});

	// The reviewer approves mid-turn (the real review_verdict path), same as a live reviewer chat.
	await createReviewVerdictTool().execute(
		"tc-verdict",
		{ todoId: todo.id, verdict: "approve" } as never,
		undefined,
		undefined,
		reviewerCtx(reviewerSessionId),
	);

	// The turn settles — handleReviewerSettled must drop this session's currentReview registration
	// (the earlier blocking finding: a settled reviewer must not stay addressable).
	handleReviewerSettled(reviewerSessionId, { type: "agent_settled", terminal: null });

	// A LATER turn in the same, now-settled reviewer chat tries to file a finding — it must be
	// rejected, not silently recorded without origin (the follow-up finding this fixes).
	await expect(
		createAddReviewCommentTool().execute(
			"tc-late",
			{ path: "a.ts", startLine: 1, body: "late finding" } as never,
			undefined,
			undefined,
			reviewerCtx(reviewerSessionId),
		),
	).rejects.toThrow(/no review is in flight/);
});

test("a pre-turn send rejection drops the currentReview registration, not just the in-flight latch", async () => {
	installTodoReviewSeams();

	const todo = new TodoStore(worktree, SESSION).add({
		title: "t",
		artifacts: [{ kind: "commit", sha: "sha1", label: "a" }],
	});

	// A real (faux-model) reviewer session is created normally — only the SEND of the review package
	// fails pre-turn, exactly like a delivery rejected before the reviewer's turn ever starts.
	updateConfig({ reviewModel: toWireModel(fauxReviewer.getModel()), reviewEffort: "medium" });
	const rejectingSend = () => Promise.reject(new Error("send rejected pre-turn"));

	const { reviewerSessionId } = await startTodoReviewFlow(
		{ workspaceId: WS, sessionId: SESSION, id: todo.id },
		rejectingSend,
	);

	// The rejection handling runs off the detached send's microtask queue — flush it.
	await new Promise((resolve) => setTimeout(resolve, 0));

	// The undelivered review must not leave a live registration behind: a later add_review_comment in
	// this (never actually started) reviewer chat must be rejected, not silently attributed to it.
	await expect(
		createAddReviewCommentTool().execute(
			"tc-late",
			{ path: "a.ts", startLine: 1, body: "late finding" } as never,
			undefined,
			undefined,
			reviewerCtx(reviewerSessionId),
		),
	).rejects.toThrow(/no review is in flight/);
});

test("reconcilePendingReviewsOnBoot clears a pending mark stranded by a host restart, walking every project's every workspace from disk", () => {
	// No mapping is registered for this mark — nothing in this test process ever called
	// startTodoReviewFlow — so it stands in for a mark left by a PRIOR host process that crashed or was
	// killed mid-review: on a real restart, the fresh process's in-memory registrations start empty too.
	saveProjects([{ id: "p1", name: "w", path: worktree, slug: "w", lastOpened: 1 }]);
	const todo = new TodoStore(worktree, SESSION).add({
		title: "t",
		artifacts: [{ kind: "commit", sha: "sha1", label: "a" }],
	});
	startTodoReview({ workspaceId: WS, sessionId: SESSION, id: todo.id });
	expect(readReviewMeta(worktree, SESSION).pending[todo.id]).toBeDefined();

	reconcilePendingReviewsOnBoot();

	expect(readReviewMeta(worktree, SESSION).pending[todo.id]).toBeUndefined();
});

test("isItemUnderActiveReview stays true after the verdict clears the durable pending mark, until the reviewer's turn actually settles", async () => {
	installTodoReviewSeams();
	fauxReviewer.setResponses([fauxAssistantMessage("Looks fine, no findings.")]);
	updateConfig({ reviewModel: toWireModel(fauxReviewer.getModel()), reviewEffort: "medium" });

	const todo = new TodoStore(worktree, SESSION).add({
		title: "t",
		artifacts: [{ kind: "commit", sha: "sha1", label: "a" }],
	});
	const { reviewerSessionId } = await startTodoReviewFlow({
		workspaceId: WS,
		sessionId: SESSION,
		id: todo.id,
	});
	expect(isItemUnderActiveReview(SESSION, todo.id)).toBe(true);

	// The verdict clears the DURABLE pending mark mid-turn (todos/reviews.ts) — a remove guard that
	// only reads `pending` would now wrongly allow removal, even though the reviewer's turn is still
	// live and its tool seams (add_review_comment) would still accept a call against this item.
	await createReviewVerdictTool().execute(
		"tc-verdict",
		{ todoId: todo.id, verdict: "approve" } as never,
		undefined,
		undefined,
		reviewerCtx(reviewerSessionId),
	);
	expect(readReviewMeta(worktree, SESSION).pending[todo.id]).toBeUndefined();
	expect(isItemUnderActiveReview(SESSION, todo.id)).toBe(true);

	// Only the settled turn drops the registration — this is the signal `todo.remove`'s host-side
	// guard must key off, not the (already-cleared) durable mark.
	handleReviewerSettled(reviewerSessionId, { type: "agent_settled", terminal: null });
	expect(isItemUnderActiveReview(SESSION, todo.id)).toBe(false);
});

test("closing a still-streaming reviewer chat (session.dispose) does not leak its currentReview registration forever", async () => {
	installTodoReviewSeams();
	const slow = createFauxCore({
		provider: "faux-slow",
		api: "faux-slow",
		models: [modelDef("faux-slow-model")],
		tokensPerSecond: 40,
	});
	runtime.registerProvider("faux-slow", {
		api: slow.api,
		baseUrl: "http://faux-slow.local",
		apiKey: "faux",
		streamSimple: slow.streamSimple,
		models: [{ ...modelDef("faux-slow-model"), api: slow.api }],
	});
	slow.setResponses([fauxAssistantMessage(`Reviewing… ${"word ".repeat(80)}done`)]);
	updateConfig({ reviewModel: toWireModel(slow.getModel()), reviewEffort: "medium" });

	// This file's beforeAll wires a no-op session publisher (other tests drive
	// handleReviewerSettled by hand); this test needs the REAL chain — disposeSession only
	// unsubscribes AFTER a settle event has had a chance to fire — so it installs one locally.
	setSessionPublisher((payload) => handleReviewerSettled(payload.sessionId, payload.event));
	try {
		const todo = new TodoStore(worktree, SESSION).add({
			title: "t",
			artifacts: [{ kind: "commit", sha: "sha1", label: "a" }],
		});
		const { reviewerSessionId } = await startTodoReviewFlow({
			workspaceId: WS,
			sessionId: SESSION,
			id: todo.id,
		});

		const deadline = Date.now() + 5000;
		while (!isSessionStreaming(reviewerSessionId)) {
			if (Date.now() > deadline) throw new Error("reviewer turn never started streaming");
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		expect(isItemUnderActiveReview(SESSION, todo.id)).toBe(true);

		// Mirrors host/handlers.ts's "session.dispose": abort a streaming turn before disposing it —
		// disposeSession unsubscribes from the event stream before tearing the session down, so a
		// dispose that skips this would never let handleReviewerSettled see the turn end, leaking the
		// registration (and blocking todo.remove) for the rest of the process's life.
		if (isSessionStreaming(reviewerSessionId))
			await abortSession(reviewerSessionId).catch(() => {});
		removeSession(reviewerSessionId);

		expect(isItemUnderActiveReview(SESSION, todo.id)).toBe(false);
	} finally {
		setSessionPublisher(() => {});
	}
});

test("a manual start is rejected while Review All has claimed the plan's queue, even mid-listTodos", async () => {
	installTodoReviewSeams();
	fauxReviewer.setResponses([fauxAssistantMessage("Looks fine, no findings.")]);
	updateConfig({ reviewModel: toWireModel(fauxReviewer.getModel()), reviewEffort: "medium" });

	const store = new TodoStore(worktree, SESSION);
	const a = store.add({ title: "a", artifacts: [{ kind: "commit", sha: "sha1", label: "a" }] });

	// claimReviewQueue runs synchronously before startReviewAllFlow's first await (listTodos) — so by
	// the time this next line runs, the claim already stands, exactly the window a manual start used
	// to slip through in (see host/SPEC.md).
	const reviewAll = startReviewAllFlow({ workspaceId: WS, sessionId: SESSION });
	await expect(
		startTodoReviewFlow({ workspaceId: WS, sessionId: SESSION, id: a.id }),
	).rejects.toThrow(/Review All is running/);

	const result = await reviewAll;
	expect(result).toEqual({ ok: true, total: 1 });

	// Review All's own advance started item a's review regardless — settle it so this file's shared
	// module-level maps don't leak a live review into the next test.
	const pinned = reviewerSessionFor({ workspaceId: WS, sessionId: SESSION });
	if (pinned) handleReviewerSettled(pinned, { type: "agent_settled", terminal: null });
});

test("Review All reports alreadyRunning, not a silently-discarded batch, when a manual review already holds the plan's latch", async () => {
	installTodoReviewSeams();
	fauxReviewer.setResponses([fauxAssistantMessage("Looks fine, no findings.")]);
	updateConfig({ reviewModel: toWireModel(fauxReviewer.getModel()), reviewEffort: "medium" });

	const store = new TodoStore(worktree, SESSION);
	const a = store.add({ title: "a", artifacts: [{ kind: "commit", sha: "sha1", label: "a" }] });

	const { reviewerSessionId } = await startTodoReviewFlow({
		workspaceId: WS,
		sessionId: SESSION,
		id: a.id,
	});

	const result = await startReviewAllFlow({ workspaceId: WS, sessionId: SESSION });
	expect(result).toEqual({ ok: true, total: 0, alreadyRunning: true });

	handleReviewerSettled(reviewerSessionId, { type: "agent_settled", terminal: null });
});

test("when reflection refutes every candidate, no empty fix request is sent — the auto cycle settles terminally instead of stranding the item", async () => {
	installTodoReviewSeams();
	fauxReviewer.setResponses([
		fauxAssistantMessage("This looks wrong."),
		fauxAssistantMessage("Judging the finding…"),
	]);
	updateConfig({ reviewModel: toWireModel(fauxReviewer.getModel()), reviewEffort: "medium" });

	// listSessions(WS, ...) is workspace-scoped only — this file reuses WS across every test and
	// never disposes a settled test's sessions until afterAll, so a "not the reviewer" filter alone
	// would pick up an unrelated leftover session from an earlier test. Snapshot what already exists
	// so the reflector is identified by actually being NEW, not merely by not being the reviewer.
	const before = new Set((await listSessions(WS, worktree)).map((s) => s.sessionId));

	const todo = new TodoStore(worktree, SESSION).add({
		title: "t",
		artifacts: [{ kind: "commit", sha: "sha1", label: "a" }],
	});
	const ref = { workspaceId: WS, sessionId: SESSION, id: todo.id };

	const { reviewerSessionId } = await startTodoReviewFlow({
		workspaceId: WS,
		sessionId: SESSION,
		id: todo.id,
	});
	await createAddReviewCommentTool().execute(
		"tc-finding",
		{ path: "a.ts", startLine: 1, body: "this looks wrong" } as never,
		undefined,
		undefined,
		reviewerCtx(reviewerSessionId),
	);
	const [finding] = await itemFixFindings(ref);
	expect(finding).toBeDefined();
	if (!finding) throw new Error("unreachable");

	await createReviewVerdictTool().execute(
		"tc-verdict",
		{ todoId: todo.id, verdict: "request_changes", note: "please fix" } as never,
		undefined,
		undefined,
		reviewerCtx(reviewerSessionId),
	);
	expect(todoReviewAutoCycles(ref)).toBe(1);
	handleReviewerSettled(reviewerSessionId, { type: "agent_settled", terminal: null });
	expect(isItemUnderActiveReview(SESSION, todo.id)).toBe(true);

	// fireReflection fires the transient reflector session detached, registering it in `pendingFix`
	// right after creation but before this test can observe it — retry the actual reflect_finding
	// call (not just session existence) until the registration has definitely landed.
	const deadline = Date.now() + 5000;
	let reflectorSessionId: string | undefined;
	let lastErr: unknown;
	while (!reflectorSessionId) {
		if (Date.now() > deadline) throw lastErr ?? new Error("reflector session never became ready");
		const sessions = await listSessions(WS, worktree);
		const candidate = sessions.find(
			(s) => !before.has(s.sessionId) && s.sessionId !== reviewerSessionId,
		)?.sessionId;
		if (candidate) {
			try {
				await createReflectFindingTool().execute(
					"tc-reflect",
					{
						commentId: finding.id,
						verdict: "refuted",
						confidence: "high",
						reason: "not actually a bug",
					} as never,
					undefined,
					undefined,
					reviewerCtx(candidate),
				);
				reflectorSessionId = candidate;
				break;
			} catch (err) {
				lastErr = err;
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	maybeResumeReflection(reflectorSessionId);
	while (todoReviewAutoCycles(ref) !== 2) {
		if (Date.now() > deadline) throw new Error("reflected fix did not settle");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}

	// Never sent (nothing survived reflection) — still a draft, badged, for the human to see.
	const after = (await getReviewSnapshot(WS)).comments.find((c) => c.id === finding.id);
	expect(after?.status).toBe("draft");
	// The cycle settles terminally rather than staying "spent but unresolved" forever: nothing will
	// ever land a fresh artifact delta for this item (the worker was never asked to change anything),
	// so maybeAutoReReview's trigger would otherwise never fire again — see host/SPEC.md.
	expect(todoReviewAutoCycles(ref)).toBe(2);
	expect(isItemUnderActiveReview(SESSION, todo.id)).toBe(false);

	handleReviewerSettled(reflectorSessionId, { type: "agent_settled", terminal: null });
});

test("request_changes with no inline findings (a whole-change note only) still sends the fix — candidateIds empty from the start is not 'every candidate refuted'", async () => {
	installTodoReviewSeams();
	fauxReviewer.setResponses([
		fauxAssistantMessage("Looks wrong overall, no specific line to cite."),
	]);

	const todo = new TodoStore(worktree, SESSION).add({
		title: "t",
		artifacts: [{ kind: "commit", sha: "sha1", label: "a" }],
	});
	const ref = { workspaceId: WS, sessionId: SESSION, id: todo.id };

	const { reviewerSessionId } = await startTodoReviewFlow({
		workspaceId: WS,
		sessionId: SESSION,
		id: todo.id,
	});

	expect(await itemFixFindings(ref)).toHaveLength(0);

	const result = await createReviewVerdictTool().execute(
		"tc-verdict",
		{
			todoId: todo.id,
			verdict: "request_changes",
			note: "the whole approach here is wrong, please redo it",
		} as never,
		undefined,
		undefined,
		reviewerCtx(reviewerSessionId),
	);
	const [content] = (result as { content: { type: "text"; text: string }[] }).content;
	expect(content?.text).toMatch(/no findings to send/);

	expect(todoReviewAutoCycles(ref)).toBe(1);

	handleReviewerSettled(reviewerSessionId, { type: "agent_settled", terminal: null });
});
