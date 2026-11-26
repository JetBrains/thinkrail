import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PiEvent, SessionEventPayload, Workspace } from "@thinkrail/contracts";
import * as agent from "../agent";
import { resetAnalyticsForTests } from "../analytics";
import { resetJbcentralStateForTests } from "../auth";
import { forgetOpenBranchReview } from "../branch-review";
import { saveWorkspaces } from "../persistence";
import { resetConfigCache } from "../settings";
import * as subprocess from "../subprocess";
import {
	createChatRecord,
	getWorkspace,
	resetChatIdCache,
	setWorkspaceReview,
	syncWorkspaceBranch,
} from "../workspaces";
import { createServer, type RunningServer } from "./server";
import * as lifecycle from "./settledLifecycle";
import { until } from "./testFixtures";

type ProviderReview = {
	number: number;
	state: "OPEN" | "MERGED" | "CLOSED";
	mergedAt?: string;
	closedAt?: string;
};

const saved = {
	THINKRAIL_DATA_DIR: process.env.THINKRAIL_DATA_DIR,
	PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
	PI_OFFLINE: process.env.PI_OFFLINE,
};
const realRun = subprocess.runBounded;
const realPublisher = agent.setSessionPublisher;
let root: string;
let workspace: Workspace;
let server: RunningServer | undefined;
let publish: ((payload: SessionEventPayload, workspaceId: string) => void) | undefined;
let reviews: Map<string, ProviderReview[]>;
let calls: string[][];
let provider: (command: string[]) => Promise<string>;

function git(...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", workspace.worktreePath, ...args], {
		stdout: "ignore",
		stderr: "pipe",
	});
	if (!result.success) throw new Error(result.stderr.toString());
}

function reviewRows(command: string[]): string {
	const branch = command[command.indexOf("--head") + 1] ?? "";
	const openOnly = command[command.indexOf("--state") + 1] === "open";
	return JSON.stringify(
		(reviews.get(branch) ?? []).filter((review) => !openOnly || review.state === "OPEN"),
	);
}

function runWithFakeProvider(
	command: string[],
	options: subprocess.BoundedBytesRunOptions,
): Promise<subprocess.BoundedBytesRun>;
function runWithFakeProvider(
	command: string[],
	options: subprocess.BoundedRunOptions,
): Promise<subprocess.BoundedRun>;
async function runWithFakeProvider(
	command: string[],
	options: subprocess.BoundedRunOptions | subprocess.BoundedBytesRunOptions,
): Promise<subprocess.BoundedRun | subprocess.BoundedBytesRun> {
	if (command[0] !== "gh") {
		return options.stdout === "bytes" ? realRun(command, options) : realRun(command, options);
	}
	calls.push(command);
	const out = await provider(command);
	const result = {
		ok: true,
		err: "",
		timedOut: false,
		launchFailed: false,
		waitedMs: 0,
	};
	return options.stdout === "bytes"
		? { ...result, out: new TextEncoder().encode(out) }
		: { ...result, out };
}

beforeEach(async () => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "thinkrail-review-refresh-")));
	const data = join(root, "data");
	mkdirSync(data);
	process.env.THINKRAIL_DATA_DIR = data;
	process.env.PI_CODING_AGENT_DIR = join(root, "pi");
	process.env.PI_OFFLINE = "1";
	resetConfigCache();
	resetChatIdCache();
	await resetJbcentralStateForTests();
	agent.configurePiRuntime(null);
	workspace = {
		id: "w1",
		projectId: "p1",
		kind: "default",
		name: "Default",
		branch: "feature",
		baseBranch: "origin/main",
		worktreePath: join(root, "repo"),
		lastActiveAt: Date.now(),
	};
	mkdirSync(workspace.worktreePath);
	git("init", "-b", "main");
	git("config", "user.email", "t@thinkrail.test");
	git("config", "user.name", "test");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(workspace.worktreePath, "README.md"), "# repo\n");
	git("add", "README.md");
	git("commit", "-m", "init");
	git("switch", "-c", "feature");
	git("remote", "add", "origin", "https://github.com/acme/app.git");
	git("update-ref", "refs/remotes/origin/main", "main");
	saveWorkspaces([workspace]);
	writeFileSync(
		join(data, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: workspace.worktreePath, lastOpened: 1 }]),
	);
	reviews = new Map();
	calls = [];
	provider = async (command) => reviewRows(command);
	spyOn(subprocess, "runBounded").mockImplementation(runWithFakeProvider);
	publish = undefined;
	spyOn(agent, "setSessionPublisher").mockImplementation((fn) => {
		publish = fn;
		realPublisher(fn);
	});
});

afterEach(async () => {
	await server?.shutdown();
	server = undefined;
	mock.restore();
	agent.setSessionPublisher(() => {});
	agent.configurePiRuntime(null);
	forgetOpenBranchReview(workspace.worktreePath);
	resetAnalyticsForTests();
	await resetJbcentralStateForTests();
	resetConfigCache();
	resetChatIdCache();
	rmSync(root, { recursive: true, force: true });
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

function emit(event: PiEvent): void {
	if (!publish) throw new Error("the host installed no session publisher");
	publish({ sessionId: "review-session", event }, workspace.id);
}

test("the periodic pass discovers, merges, and reopens a Default workspace's PR without focus", async () => {
	expect(await lifecycle.findWorkspaceReviewOutcome(workspace, { fresh: false })).toEqual({
		value: null,
		reliable: true,
	});
	expect(calls).toHaveLength(2);
	reviews.set("feature", [{ number: 42, state: "OPEN" }]);
	await lifecycle.refreshOpenProjectReviews();
	expect(getWorkspace(workspace.id).review).toMatchObject({ number: 42, state: "open" });

	const mergedAt = new Date().toISOString();
	reviews.set("feature", [{ number: 42, state: "MERGED", mergedAt }]);
	await lifecycle.refreshOpenProjectReviews();
	expect(getWorkspace(workspace.id).review).toMatchObject({ number: 42, state: "merged" });

	reviews.set("feature", [{ number: 42, state: "OPEN" }]);
	await lifecycle.refreshOpenProjectReviews();
	expect(getWorkspace(workspace.id).review).toMatchObject({ number: 42, state: "open" });
});

test("the host refreshes a cached missing PR at agent_settled, not agent_end", async () => {
	server = await createServer({ port: 0, host: "127.0.0.1", analytics: { mute: true } });
	await lifecycle.findWorkspaceReviewOutcome(workspace, { fresh: false });
	expect(calls).toHaveLength(2);
	reviews.set("feature", [{ number: 51, state: "OPEN" }]);
	emit({ type: "agent_end", messages: [], willRetry: true });
	await Bun.sleep(50);
	expect(calls).toHaveLength(2);
	expect(getWorkspace(workspace.id).review).toBeUndefined();

	emit({ type: "agent_settled", terminal: null });
	await until(() => getWorkspace(workspace.id).review?.number === 51, "the settled PR", 2_000);
	expect(calls).toHaveLength(3);
	expect(getWorkspace(workspace.id).review?.state).toBe("open");
});

test("overlapping settlements share one trailing fresh lookup and a later turn can refresh again", async () => {
	const held: { command: string[]; release: (value: string) => void }[] = [];
	const requests: Promise<void>[] = [];
	let paused = true;
	provider = (command) =>
		paused
			? new Promise((release) => held.push({ command, release }))
			: Promise.resolve(reviewRows(command));
	try {
		const first = lifecycle.refreshReviewAfterAgentSettled(workspace.id);
		requests.push(first);
		await until(() => held.length === 1, "the first lookup");
		for (let index = 0; index < 20; index++) {
			requests.push(lifecycle.refreshReviewAfterAgentSettled(workspace.id));
		}
		expect(calls).toHaveLength(1);
		reviews.set("feature", [{ number: 61, state: "OPEN" }]);
		held[0]?.release(reviewRows(held[0].command));
		await first;
		await until(() => held.length === 2, "one trailing lookup");
		expect(calls).toHaveLength(2);
		reviews.set("feature", [{ number: 62, state: "OPEN" }]);
		held[1]?.release(reviewRows(held[1].command));
		await Promise.all(requests);
		expect(getWorkspace(workspace.id).review?.number).toBe(62);
		expect(calls).toHaveLength(2);
	} finally {
		paused = false;
		for (const pending of held) pending.release(reviewRows(pending.command));
		await Promise.allSettled(requests);
	}
	await lifecycle.refreshReviewAfterAgentSettled(workspace.id);
	expect(calls).toHaveLength(3);
});

test("a settled refresh follows a checkout switch and never looks up the base branch", async () => {
	git("switch", "-c", "other");
	reviews.set("feature", [{ number: 71, state: "OPEN" }]);
	reviews.set("other", [{ number: 72, state: "OPEN" }]);
	await lifecycle.refreshReviewAfterAgentSettled(workspace.id);
	expect(getWorkspace(workspace.id)).toMatchObject({
		branch: "other",
		review: { number: 72, state: "open" },
	});
	expect(calls).toHaveLength(1);
	expect(calls[0]).toContain("other");

	git("switch", "main");
	await lifecycle.refreshReviewAfterAgentSettled(workspace.id);
	expect(getWorkspace(workspace.id).branch).toBe("main");
	expect(getWorkspace(workspace.id).review).toBeUndefined();
	expect(calls).toHaveLength(1);
});

test("a lookup for a branch switched while the provider was answering cannot attach its review", async () => {
	let release: ((value: string) => void) | undefined;
	let paused = true;
	provider = (command) =>
		paused ? new Promise((resolve) => (release = resolve)) : Promise.resolve(reviewRows(command));
	const pending = lifecycle.refreshReviewAfterAgentSettled(workspace.id);
	try {
		await until(() => release !== undefined, "the held lookup");
		git("switch", "-c", "other");
		syncWorkspaceBranch(workspace.id);
	} finally {
		paused = false;
		release?.('[{"number":81,"state":"OPEN"}]');
		await pending;
	}
	expect(getWorkspace(workspace.id).branch).toBe("other");
	expect(getWorkspace(workspace.id).review).toBeUndefined();

	provider = async (command) => reviewRows(command);
	reviews.set("other", [{ number: 82, state: "OPEN" }]);
	await lifecycle.refreshReviewAfterAgentSettled(workspace.id);
	expect(getWorkspace(workspace.id).review?.number).toBe(82);
});

test("a failed provider preserves the last review, while a reliable missing review clears it", async () => {
	setWorkspaceReview(workspace.id, { kind: "pull-request", number: 91, state: "open" }, "feature");
	provider = async () => {
		throw new Error("provider unavailable");
	};
	await lifecycle.refreshReviewAfterAgentSettled(workspace.id);
	expect(getWorkspace(workspace.id).review?.number).toBe(91);

	provider = async (command) => reviewRows(command);
	await lifecycle.refreshReviewAfterAgentSettled(workspace.id);
	expect(getWorkspace(workspace.id).review).toBeUndefined();
});

test("chat and removed workspaces do not start provider lookups", async () => {
	const chat = createChatRecord();
	await lifecycle.refreshReviewAfterAgentSettled(chat.id);
	saveWorkspaces([]);
	await lifecycle.refreshReviewAfterAgentSettled(workspace.id);
	expect(calls).toEqual([]);
});
