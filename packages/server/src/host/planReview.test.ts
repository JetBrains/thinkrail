import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
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
import { saveWorkspaces } from "../persistence";
import { getReviewSnapshot } from "../reviews";
import { resetConfigCache, updateConfig } from "../settings";
import { todoReviewAutoCycles, todoReviewRecord } from "../todos";
import { itemReviewActive } from "./planReviewQueue";
import { type ReviewRunner, startPlanReview } from "./requestReview";

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
