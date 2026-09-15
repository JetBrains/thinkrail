import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenPrResult, ProviderStatusReport, Workspace } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { TodoStore } from "pi-todos/core";
import {
	type AdditionalAnalyticsCapture,
	type AdditionalAnalyticsEvent,
	initializeAnalytics,
	resetAnalyticsForTests,
	setAdditionalAnalyticsEnabled,
	shutdownAnalytics,
} from "../analytics";
import { gitHeadSha } from "../git";
import { resetConfigCache } from "../settings";
import { maybeAttachChangeArtifacts, settleChangeArtifacts } from "../todos";
import { handleRequest } from "./handlers";
import { dropLogin, recordLoginStart, trackLoginOutcome } from "./loginAnalytics";
import {
	additionalAnalyticsEnabled,
	captureAdditional,
	centralConnectOutcome,
	failureReason,
	observeCurrentSetup,
	observePrAction,
	observeSetupAction,
	observeSetupRead,
	providerAvailability,
	SetupObservation,
	setupObservation,
} from "./productAnalytics";
import { TaskObservation, taskObservation } from "./taskAnalytics";

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
interface SentEvent {
	event: string;
	properties: Record<string, unknown>;
}
let sent: SentEvent[];

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "thinkrail-host-observation-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	resetConfigCache();
	setupObservation.clear();
	taskObservation.clear();
	sent = [];
	initializeAnalytics({
		additionalEnabled: true,
		env: {},
		fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
			sent.push(...JSON.parse(String(init?.body)).batch);
			return new Response("{}", { status: 200 });
		}) as typeof fetch,
	});
});

afterEach(async () => {
	await shutdownAnalytics();
	resetAnalyticsForTests();
	resetConfigCache();
	setupObservation.clear();
	taskObservation.clear();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

async function captured(name: string) {
	await shutdownAnalytics();
	return sent.filter((entry) => entry.event === name);
}

test("legacy enabled without confirmation never grants additional consent", () => {
	for (const analyticsEnabled of [true, false]) {
		for (const analyticsConsentConfirmed of [true, false]) {
			expect(additionalAnalyticsEnabled({ analyticsEnabled, analyticsConsentConfirmed })).toBe(
				analyticsEnabled && analyticsConsentConfirmed,
			);
		}
	}
});

test("current setup snapshots never probe without consent or outlive their initiating grant", async () => {
	let reads = 0;
	const result = {
		project_present: "yes",
		provider_available: "yes",
		model_available: "yes",
	} as const;
	setAdditionalAnalyticsEnabled(false);
	await observeCurrentSetup(async () => {
		reads++;
		return result;
	});
	expect(reads).toBe(0);
	setAdditionalAnalyticsEnabled(true);
	const pending = Promise.withResolvers<typeof result>();
	const oldSnapshot = observeCurrentSetup(() => pending.promise);
	setAdditionalAnalyticsEnabled(false);
	setAdditionalAnalyticsEnabled(true);
	pending.resolve(result);
	await oldSnapshot;
	expect(await captured("setup_state_observed")).toEqual([]);
});

test("readiness deduplicates actual state per grant and never replays a stale asynchronous result", async () => {
	const events: AdditionalAnalyticsEvent[] = [];
	let capture: AdditionalAnalyticsCapture | null = (event) => events.push(event);
	const observation = new SetupObservation(() => capture);
	observation.observe(capture, { provider_available: "no" });
	observation.observe(capture, { provider_available: "no" });
	observation.observe(capture, {});
	observation.observe(capture, { provider_available: "yes", project_present: "yes" });
	expect(events).toHaveLength(2);
	const old = capture;
	capture = null;
	observation.observe(capture, { model_available: "yes" });
	capture = (event) => events.push(event);
	observation.observe(old, { model_available: "yes" });
	observation.observe(capture, { provider_available: "yes" });
	expect(events[2]).toEqual({
		name: "setup_state_observed",
		params: { provider_available: "yes", model_available: "unknown", project_present: "unknown" },
	});
	const gate = Promise.withResolvers<number>();
	const pending = observeSetupRead(
		() => gate.promise,
		() => ({ model_available: "yes" }),
	);
	setAdditionalAnalyticsEnabled(false);
	setAdditionalAnalyticsEnabled(true);
	gate.resolve(1);
	await pending;
	expect(await captured("setup_state_observed")).toEqual([]);
});

test("readiness uses existing provider truth without probing Central or any provider", () => {
	const report: ProviderStatusReport = {
		providers: [],
		jbcentral: { state: "absent" },
		jbcentralInstall: { platform: "private", shell: "bash", command: "secret" },
	};
	expect(providerAvailability(report)).toBe("no");
	expect(
		providerAvailability({ ...report, jbcentral: { state: "probe-failed", reason: "timed-out" } }),
	).toBe("unknown");
	expect(
		providerAvailability({
			...report,
			jbcentral: { state: "configured", version: "private", signedOut: false, proxyStopped: false },
		}),
	).toBe("yes");
	expect(
		providerAvailability({
			...report,
			providers: [{ id: "private", name: "private", configured: true }],
		}),
	).toBe("yes");
});

test("setup reports applied outcomes, not resolved-but-failed results or error text", async () => {
	expect(centralConnectOutcome({ outcome: "failed", reason: "unsupported-version" })).toEqual({
		outcome: "failed",
		reason: "unsupported",
	});
	await observeSetupAction(
		"provider_connect",
		async () => ({ outcome: "failed", reason: "candidate-failed" }) as const,
		centralConnectOutcome,
	);
	await observeSetupAction("project_open", () => ({ path: "/secret/repo" }));
	await expect(
		observeSetupAction("project_init", () => {
			throw new Error("private error");
		}),
	).rejects.toThrow("private error");
	const events = await captured("setup_action_finished");
	expect(
		events.map((event) => [
			event.properties.action,
			event.properties.outcome,
			event.properties.reason,
		]),
	).toEqual([
		["provider_connect", "failed", "unknown"],
		["project_open", "succeeded", "none"],
		["project_init", "failed", "unknown"],
	]);
	expect(JSON.stringify(sent)).not.toContain("private error");
	expect(JSON.stringify(sent)).not.toContain("/secret/repo");
});

test("async operations keep the initiating grant through revoke and regrant", async () => {
	const gate = Promise.withResolvers<void>();
	const setup = observeSetupAction("project_open", () => gate.promise);
	const pr = observePrAction(async () => {
		await gate.promise;
		return { action: "created", dirtyFiles: 0 };
	});
	recordLoginStart("old", "oauth");
	setAdditionalAnalyticsEnabled(false);
	const unconsented = observeSetupAction("project_init", () => gate.promise);
	setAdditionalAnalyticsEnabled(true);
	gate.resolve();
	await Promise.all([setup, pr, unconsented]);
	trackLoginOutcome({ loginId: "old", providerId: "anthropic", frame: { kind: "success" } });
	await shutdownAnalytics();
	expect(
		sent.filter((event) => event.event !== "app_started" && event.event !== "provider_login"),
	).toEqual([]);
	expect(sent.filter((event) => event.event === "provider_login")).toHaveLength(1);
});

test("correlated login success, failure and cancellation count once; progress and unknown ids do not", async () => {
	for (const loginId of ["success", "failure", "cancelled"]) recordLoginStart(loginId, "api_key");
	trackLoginOutcome({
		loginId: "success",
		providerId: "private-provider",
		frame: { kind: "progress", message: "secret" },
	});
	trackLoginOutcome({
		loginId: "success",
		providerId: "private-provider",
		frame: { kind: "success" },
	});
	trackLoginOutcome({
		loginId: "success",
		providerId: "private-provider",
		frame: { kind: "success" },
	});
	trackLoginOutcome({
		loginId: "failure",
		providerId: "private-provider",
		frame: { kind: "error", message: "secret" },
	});
	dropLogin("cancelled");
	trackLoginOutcome({
		loginId: "cancelled",
		providerId: "private-provider",
		frame: { kind: "success" },
	});
	const events = await captured("setup_action_finished");
	expect(events.map((event) => event.properties.outcome)).toEqual([
		"succeeded",
		"failed",
		"cancelled",
	]);
	expect(JSON.stringify(sent)).not.toContain("private-provider");
	expect(JSON.stringify(sent)).not.toContain("secret");
});

test("PR created, updated, push and compare are distinct; an unrefreshed update is not success", async () => {
	const results: OpenPrResult[] = [
		{ action: "created", dirtyFiles: 42, url: "https://private" },
		{ action: "updated", dirtyFiles: 0, bodyRefreshed: true },
		{ action: "updated", dirtyFiles: 0, bodyRefreshed: false },
		{ action: "pushed", dirtyFiles: 0 },
		{
			action: "compare",
			dirtyFiles: 0,
			compareUrl: "https://private",
			ghProblem: "unauthenticated",
		},
	];
	for (const result of results) expect(await observePrAction(async () => result)).toBe(result);
	await expect(
		observePrAction(async () => {
			throw new CodedError("PUSH_AUTH_FAILED", "private credentials");
		}),
	).rejects.toThrow("private credentials");
	const events = await captured("pr_action_finished");
	expect(
		events.map((event) => [
			event.properties.action,
			event.properties.outcome,
			event.properties.reason,
		]),
	).toEqual([
		["created", "succeeded", "none"],
		["updated", "succeeded", "none"],
		["updated", "failed", "unknown"],
		["pushed", "succeeded", "none"],
		["compare", "succeeded", "auth"],
		["unknown", "failed", "auth"],
	]);
	expect(JSON.stringify(sent)).not.toContain("private");
	expect(events.every((event) => !("dirtyFiles" in event.properties))).toBe(true);
});

test("observational sink and projection failures cannot change a successful feature result", async () => {
	expect(() =>
		captureAdditional(
			() => {
				throw new Error("sink");
			},
			{ name: "review_decided", params: { actor: "user", verdict: "approved" } },
		),
	).not.toThrow();
	expect(
		await observeSetupAction(
			"project_open",
			() => 7,
			() => {
				throw new Error("projection");
			},
		),
	).toBe(7);
	expect(
		await observeSetupRead(
			() => 8,
			() => {
				throw new Error("projection");
			},
		),
	).toBe(8);
	const result: OpenPrResult = { action: "pushed", dirtyFiles: 0 };
	Object.defineProperty(result, "action", {
		get() {
			throw new Error("projection");
		},
	});
	expect(await observePrAction(async () => result)).toBe(result);
	expect(failureReason(new Error("PUSH_AUTH_FAILED secret"))).toBe("unknown");
});

function git(root: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "ignore", stderr: "pipe" });
	if (!result.success) throw new Error(`git fixture failed: ${args[0]}`);
}

async function taskFixture() {
	const root = join(dataDir, "repo");
	mkdirSync(root);
	git(root, "init", "-b", "main");
	git(root, "config", "user.name", "test");
	git(root, "config", "user.email", "test@example.invalid");
	git(root, "config", "commit.gpgsign", "false");
	writeFileSync(join(root, "README.md"), "initial\n");
	git(root, "add", "README.md");
	git(root, "commit", "-m", "initial");
	const ctx = { clientKey: "private-client" };
	const project = (await handleRequest("project.open", { path: root }, ctx)) as { id: string };
	const workspaces = (await handleRequest(
		"workspace.list",
		{ projectId: project.id, includeDiffStats: false },
		ctx,
	)) as Workspace[];
	const workspace = workspaces[0];
	if (!workspace) throw new Error("fixture workspace missing");
	const store = new TodoStore(root, "private-session");
	store.replaceAll({
		groups: [{ title: "private task", todos: [{ title: "private step", status: "pending" }] }],
	});
	const item = store.read().groups[0]?.todos[0];
	if (!item) throw new Error("fixture todo missing");
	const ref = { workspaceId: workspace.id, sessionId: "private-session", id: item.id };
	return { root, ctx, workspace, store, item, ref };
}

test("host handlers exclude Default provisioning and hydration; observing a mutation never adds Git writes", async () => {
	const { root, ctx, workspace, store, item, ref } = await taskFixture();
	await handleRequest("todo.list", ref, ctx);
	await handleRequest("todo.update", { ...ref, status: "in_progress" }, ctx);
	writeFileSync(join(root, "README.md"), "changed\n");
	await handleRequest("todo.update", { ...ref, status: "done" }, ctx);
	await handleRequest("todo.list", ref, ctx);
	await handleRequest("todo.update", { ...ref, status: "done" }, ctx);
	expect(store.get(item.id)?.artifacts ?? []).toEqual([]);
	await maybeAttachChangeArtifacts(workspace.id, ref.sessionId);
	await handleRequest("todo.review", ref, ctx);
	await shutdownAnalytics();
	expect(
		sent
			.filter((event) => event.event === "setup_action_finished")
			.map((event) => event.properties.action),
	).toEqual(["project_open"]);
	expect(
		sent
			.filter((event) => event.event === "task_completed")
			.map((event) => [event.properties.change_evidence, event.properties.verification_recorded]),
	).toEqual([["none", "no"]]);
	expect(
		sent
			.filter((event) => event.event === "review_decided")
			.map((event) => [event.properties.actor, event.properties.verdict]),
	).toEqual([["user", "approved"]]);
	expect(JSON.stringify(sent)).not.toContain("private");
});

test("canonical TODO mutation observation waits for the real artifact reconciliation", async () => {
	const { root, workspace, store, item, ref } = await taskFixture();
	store.update(item.id, { status: "in_progress" });
	await maybeAttachChangeArtifacts(workspace.id, ref.sessionId);
	writeFileSync(join(root, "README.md"), "changed by work\n");
	taskObservation.toolStarted(workspace.id, ref.sessionId, {
		type: "tool_execution_start",
		toolCallId: "private-call",
		toolName: "todo_update",
		args: {},
	});
	store.update(item.id, { status: "done", verification: "private verification claim" });
	const finish = taskObservation.toolFinished(ref.sessionId, {
		type: "tool_execution_end",
		toolCallId: "private-call",
		toolName: "todo_update",
		result: {},
		isError: false,
	});
	await maybeAttachChangeArtifacts(workspace.id, ref.sessionId);
	await finish();
	await finish();
	expect(
		(await captured("task_completed")).map((event) => [
			event.properties.change_evidence,
			event.properties.verification_recorded,
		]),
	).toEqual([["commit", "yes"]]);
	expect(JSON.stringify(sent)).not.toContain("private");
});

for (const revokeWhileWaiting of [false, true]) {
	test(`concurrent plan summary retries real Git reconciliation before task evidence${revokeWhileWaiting ? "; revocation drops the waiting event" : " is finalized"}`, async () => {
		const { root, workspace, store, item, ref } = await taskFixture();
		const events: AdditionalAnalyticsEvent[] = [];
		let capture: AdditionalAnalyticsCapture | null = (event) => events.push(event);
		const observer = new TaskObservation(() => capture);
		store.update(item.id, { status: "in_progress" });
		await maybeAttachChangeArtifacts(workspace.id, ref.sessionId);
		await settleChangeArtifacts(workspace.id);
		writeFileSync(join(root, "README.md"), "concurrent summary work\n");
		observer.toolStarted(workspace.id, ref.sessionId, {
			type: "tool_execution_start",
			toolCallId: "private-call",
			toolName: "todo_update",
			args: {},
		});
		store.update(item.id, { status: "done", verification: "private verification claim" });
		const finish = observer.toolFinished(ref.sessionId, {
			type: "tool_execution_end",
			toolCallId: "private-call",
			toolName: "todo_update",
			result: {},
			isError: false,
		});
		const first = maybeAttachChangeArtifacts(workspace.id, ref.sessionId);
		const completion = first.then(async () => {
			expect(store.get(item.id)?.artifacts ?? []).toEqual([]);
			const waiting = finish();
			if (revokeWhileWaiting) {
				capture = null;
				observer.clear();
				capture = (event) => events.push(event);
			}
			await waiting;
		});
		store.setSummary("private concurrent summary");
		const second = maybeAttachChangeArtifacts(workspace.id, ref.sessionId);
		await Promise.all([completion, second]);
		await finish();
		expect(store.read().summary).toBe("private concurrent summary");
		const head = gitHeadSha(workspace.id);
		if (!head) throw new Error("fixture commit missing");
		expect(store.get(item.id)?.artifacts).toEqual([
			{ kind: "commit", sha: head, label: item.title },
		]);
		expect(events).toEqual(
			revokeWhileWaiting
				? []
				: [
						{
							name: "task_completed",
							params: { change_evidence: "commit", verification_recorded: "yes" },
						},
					],
		);
		expect(JSON.stringify(events)).not.toContain("private");
	});
}
