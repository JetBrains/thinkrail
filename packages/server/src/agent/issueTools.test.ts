import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { CodedError } from "@thinkrail/shared/codedError";
import { Check } from "typebox/value";
import { buildResourceLoader, childExtensionFactories } from "./extensions";
import {
	createIssueContextTool,
	createIssueExecuteConfirmationTool,
	createIssueJoinRepositoryTool,
	createIssuePrepareConfirmationTool,
	createIssueRecordSummaryTool,
	type IssueToolHost,
	issueToolsExtension,
	setIssueToolHost,
} from "./issueTools";

const ctx = {
	sessionManager: { getSessionId: () => "own-session" },
} as unknown as ExtensionToolContext;
afterEach(() => setIssueToolHost(null));

function fakeHost(): { host: IssueToolHost; calls: unknown[][] } {
	const calls: unknown[][] = [];
	return {
		calls,
		host: {
			context: async (...args) => {
				calls.push(args);
				return "Bound issue context";
			},
			recordSummary: async (...args) => {
				calls.push(args);
				return { noteId: 42, url: "https://example.test/note/42" };
			},
		},
	};
}

const context = (params: unknown) =>
	createIssueContextTool().execute("call", params as never, undefined, undefined, ctx);
const record = (params: unknown) =>
	createIssueRecordSummaryTool().execute("call", params as never, undefined, undefined, ctx);

async function expectClosedFailure(promise: Promise<unknown>, code: string, message: string) {
	try {
		await promise;
		throw new Error("Expected failure");
	} catch (error) {
		expect(error).toBeInstanceOf(CodedError);
		expect(error).toMatchObject({ code, message });
		expect((error as Error).cause).toBeUndefined();
		expect(String(error)).not.toContain("secret");
	}
}

test("tools delegate only their SDK session identity and return host results", async () => {
	const { host, calls } = fakeHost();
	setIssueToolHost(host);
	expect((await context({})).content).toEqual([{ type: "text", text: "Bound issue context" }]);
	const result = await record({ operationId: "summary-1", summary: " 完成 \n" });
	expect(result.details).toEqual({ noteId: 42, url: "https://example.test/note/42" });
	expect(result.content).toEqual([
		{ type: "text", text: JSON.stringify({ noteId: 42, url: "https://example.test/note/42" }) },
	]);
	expect(calls).toEqual([["own-session"], ["own-session", "summary-1", " 完成 \n"]]);
});

test("context has exact empty parameters, enforced at execute time", async () => {
	const { host, calls } = fakeHost();
	setIssueToolHost(host);
	expect(createIssueContextTool().parameters).toMatchObject({ additionalProperties: false });
	for (const input of [
		null,
		undefined,
		[],
		"",
		1,
		{ reference: "secret" },
		{ sessionId: "other" },
	]) {
		await expectClosedFailure(context(input), "RANGE_INVALID", "Invalid Issue tool parameters.");
	}
	expect(calls).toEqual([]);
});

test("summary schema accepts nonblank text and rejects whitespace-only text", () => {
	const schema = createIssueRecordSummaryTool().parameters;
	expect(Check(schema, { operationId: "op-1", summary: "done" })).toBe(true);
	expect(Check(schema, { operationId: "op-1", summary: " \n\t" })).toBe(false);
});

test("summary strictly validates keys, bounded operation id and nonblank UTF-8 bytes", async () => {
	const { host, calls } = fakeHost();
	setIssueToolHost(host);
	expect(createIssueRecordSummaryTool().parameters).toMatchObject({ additionalProperties: false });
	const valid = { operationId: "op-1", summary: "done" };
	for (const input of [
		null,
		undefined,
		[],
		"secret",
		{},
		{ ...valid, operationId: "" },
		{ ...valid, operationId: "x".repeat(129) },
		{ ...valid, operationId: "invalid id" },
		{ ...valid, operationId: 1 },
		{ ...valid, summary: " \n\t" },
		{ ...valid, summary: 1 },
		{ ...valid, summary: "x".repeat(32001) },
		{ ...valid, summary: "😀".repeat(8001) },
		...["reference", "projectId", "path", "sessionId", "token"].map((key) => ({
			...valid,
			[key]: "secret",
		})),
	]) {
		await expectClosedFailure(record(input), "RANGE_INVALID", "Invalid Issue tool parameters.");
	}
	expect(calls).toEqual([]);
	await record({ operationId: "x".repeat(128), summary: "😀".repeat(8000) });
	expect(calls).toHaveLength(1);
});

test("default, reset, and arbitrary host failures are static coded errors without causes", async () => {
	const unavailable = "Issue tools are unavailable for this session.";
	await expectClosedFailure(context({}), "RESOURCE_UNAVAILABLE", unavailable);
	setIssueToolHost({
		context: async () => {
			throw new Error("secret token/path");
		},
		recordSummary: async () => {
			throw new CodedError("RANGE_INVALID", "secret provider body");
		},
	});
	await expectClosedFailure(context({}), "RESOURCE_UNAVAILABLE", unavailable);
	await expectClosedFailure(
		record({ operationId: "op", summary: "done" }),
		"RESOURCE_UNAVAILABLE",
		unavailable,
	);
	setIssueToolHost(fakeHost().host);
	await context({});
	setIssueToolHost(null);
	await expectClosedFailure(context({}), "RESOURCE_UNAVAILABLE", unavailable);
	await expectClosedFailure(
		record({ operationId: "op", summary: "done" }),
		"RESOURCE_UNAVAILABLE",
		unavailable,
	);
});

test("confirmation preparation supports read-only inspection and passes it to the host", async () => {
	const { host } = fakeHost();
	let inspected = false;
	host.prepareConfirmation = async (_sessionId, input) => {
		inspected = input.inspect === true;
		return { status: "uncertain", questions: { questions: [] }, nextAction: "inspect remote" };
	};
	setIssueToolHost(host);
	const tool = createIssuePrepareConfirmationTool();
	const params = { operationId: "op", inspect: true };
	expect(Check(tool.parameters, params)).toBe(true);
	expect(Check(tool.parameters, { operationId: "op", continueDespiteChecks: true })).toBe(true);
	expect(Check(tool.parameters, { operationId: "op", recovery: "reconcile" })).toBe(true);
	expect(Check(tool.parameters, { operationId: "op", recovery: "resend" })).toBe(false);
	expect(
		Check(tool.parameters, { operationId: "body", action: "update-body", body: "Replacement" }),
	).toBe(true);
	expect(
		Check(tool.parameters, {
			operationId: "close",
			action: "close-issue",
			reason: "Accepted",
			acceptance: "All verified",
		}),
	).toBe(true);
	expect(Check(tool.parameters, { operationId: "body", action: "close" })).toBe(false);
	const result = await tool.execute("call", params, undefined, undefined, ctx);
	expect(inspected).toBe(true);
	expect(result.details).toMatchObject({ status: "uncertain", nextAction: "inspect remote" });
});

test("lifecycle policy preparation and advancement reach the Issue host", async () => {
	const { host, calls } = fakeHost();
	host.prepareConfirmation = async (...args) => {
		calls.push(args);
		return { questions: { questions: [] } };
	};
	setIssueToolHost(host);
	const tool = createIssuePrepareConfirmationTool();
	const authorize = {
		operationId: "policy",
		action: "authorize-automation",
		projectId: "repo",
		title: "Lifecycle update",
		body: "Details",
		mode: "auto-merge",
		closeIssue: false,
	};
	const advance = {
		operationId: "policy",
		action: "advance-automation",
		projectId: "repo",
	} as const;
	const preflight = {
		operationId: "pairing",
		action: "preflight-dependencies",
		projectId: "downstream",
	} as const;
	expect(Check(tool.parameters, authorize)).toBe(true);
	expect(Check(tool.parameters, advance)).toBe(true);
	expect(Check(tool.parameters, preflight)).toBe(true);
	await tool.execute("call", authorize as never, undefined, undefined, ctx);
	await tool.execute("call", advance, undefined, undefined, ctx);
	await tool.execute("call", preflight, undefined, undefined, ctx);
	expect(calls).toEqual([
		["own-session", authorize],
		["own-session", advance],
		["own-session", preflight],
	]);
});

test("continuation execution forwards the real receipt and continuation identity", async () => {
	const { host } = fakeHost();
	const calls: unknown[][] = [];
	host.executeConfirmation = async (...args) => {
		calls.push(args);
		return { status: "attempted" };
	};
	setIssueToolHost(host);
	const tool = createIssueExecuteConfirmationTool();
	const params = { operationId: "op", toolCallId: "real-receipt", continuationId: "continuation" };
	expect(Check(tool.parameters, params)).toBe(true);
	await tool.execute("call", params, undefined, undefined, ctx);
	expect(calls).toEqual([["own-session", "op", "real-receipt", "continuation"]]);
});

test("extension registers the issue tools without injecting global issue instructions", () => {
	const tools: Array<{ name: string; promptGuidelines?: string[] }> = [];
	const hooks: string[] = [];
	issueToolsExtension({
		registerTool: (tool: { name: string }) => tools.push(tool),
		on: (name: string) => hooks.push(name),
	} as unknown as ExtensionAPI);
	expect(tools.map((tool) => tool.name)).toEqual([
		"issue_context",
		"issue_record_summary",
		"issue_join_repository",
		"issue_prepare_confirmation",
		"issue_execute_confirmation",
	]);
	expect(tools.every((tool) => !tool.promptGuidelines?.length)).toBe(true);
	expect(hooks).toEqual([]);
	expect(childExtensionFactories("workspace")).not.toContain(issueToolsExtension);
});

test("the shared resource loader registers issue tools as a named inline extension", async () => {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-issue-tools-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	try {
		const loader = await buildResourceLoader(
			root,
			SettingsManager.create(root, root, { projectTrusted: false }),
			() => ({
				trusted: false,
				piResourceTrusted: false,
				acknowledged: [],
				disabled: [],
				disabledGroups: [],
				enabledGroups: [],
				otherAgentSkills: false,
				overrides: {},
			}),
		);
		const extension = loader
			.getExtensions()
			.extensions.find((item) => item.path === "<inline:issue-tools>");
		expect(extension).toBeDefined();
		expect([...(extension?.tools.keys() ?? [])]).toEqual([
			"issue_context",
			"issue_record_summary",
			"issue_join_repository",
			"issue_prepare_confirmation",
			"issue_execute_confirmation",
		]);
		setIssueToolHost(fakeHost().host);
		const tool = extension?.tools.get("issue_context");
		expect(await tool?.definition.execute("call", {}, undefined, undefined, ctx)).toMatchObject({
			content: [{ type: "text", text: "Bound issue context" }],
		});
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(root, { recursive: true, force: true });
	}
}, 30_000);

test("recovery is an exact optional enum delegated unchanged and safely classified", async () => {
	const description = createIssueRecordSummaryTool().description;
	expect(description).toContain("explicit HUMAN confirmation before either recovery mode");
	expect(description).toContain("an agent must not infer it");
	expect(description).toContain("does not prove original authorship");
	expect(description).toContain("Absence, errors and timeouts are NOT proof");
	const { host, calls } = fakeHost();
	setIssueToolHost(host);
	for (const recovery of ["reconcile", "retry-confirmed-unpublished"]) {
		const params = { operationId: "op", summary: "body", recovery };
		expect(Check(createIssueRecordSummaryTool().parameters, params)).toBe(true);
		await record(params);
	}
	expect(calls).toEqual([
		["own-session", "op", "body", "reconcile"],
		["own-session", "op", "body", "retry-confirmed-unpublished"],
	]);
	for (const recovery of [undefined, null, "retry", true]) {
		await expect(record({ operationId: "op", summary: "body", recovery })).rejects.toMatchObject({
			code: "RANGE_INVALID",
		});
	}
	setIssueToolHost({
		...host,
		recordSummary: async () => {
			throw new CodedError("ISSUE_SUMMARY_RECOVERY_REQUIRED", "secret provider body");
		},
	});
	await expectClosedFailure(
		record({ operationId: "op", summary: "body" }),
		"ISSUE_SUMMARY_RECOVERY_REQUIRED",
		"Issue summary requires reconciliation. Obtain explicit human confirmation before either recovery mode; reuse the original operationId and exact summary. Retry requires human confirmation that the original request/process ended without remote publication and authorization to retry. Absence, errors and timeouts are not proof.",
	);
});

function joinContext(answer: boolean | null) {
	const asked: string[] = [];
	return {
		asked,
		ctx: {
			sessionManager: { getSessionId: () => "own-session" },
			hasUI: answer !== null,
			ui: {
				confirm: async (title: string) => {
					asked.push(title);
					return answer === true;
				},
			},
		} as unknown as ExtensionToolContext,
	};
}
const join_ = (params: unknown, context: ExtensionToolContext) =>
	createIssueJoinRepositoryTool().execute("call", params as never, undefined, undefined, context);

test("joining a reference repository asks the user first and joins only on confirmation", async () => {
	const calls: string[] = [];
	setIssueToolHost({
		...fakeHost().host,
		joinCandidate: async (sessionId, projectId) => {
			calls.push(`candidate:${sessionId}:${projectId}`);
			return { projectId, name: "core", path: "/suite/libs/core" };
		},
		joinRepository: async (sessionId, projectId) => {
			calls.push(`join:${sessionId}:${projectId}`);
			return {
				projectId,
				name: "core",
				path: "/suite/.worktrees/issue-1/libs/core",
				workspaceId: "w",
			};
		},
	});
	const declined = joinContext(false);
	expect((await join_({ projectId: "core" }, declined.ctx)).details).toEqual({ joined: false });
	expect(declined.asked).toEqual(["Join core to this Issue?"]);
	expect(calls).toEqual(["candidate:own-session:core"]);
	const confirmed = joinContext(true);
	expect((await join_({ projectId: "core" }, confirmed.ctx)).details).toMatchObject({
		joined: true,
		repository: { path: "/suite/.worktrees/issue-1/libs/core" },
	});
	expect(calls).toEqual([
		"candidate:own-session:core",
		"candidate:own-session:core",
		"join:own-session:core",
	]);
	await expect(join_({ projectId: "core" }, joinContext(null).ctx)).rejects.toThrow();
	expect(calls).toHaveLength(4);
	for (const bad of [{}, { projectId: "../x" }, { projectId: "core", extra: 1 }])
		await expect(join_(bad, confirmed.ctx)).rejects.toMatchObject({ code: "RANGE_INVALID" });
});

test("a repository the host does not offer as a reference is refused without asking", async () => {
	setIssueToolHost({
		...fakeHost().host,
		joinCandidate: async () => {
			throw new Error("secret: not a reference");
		},
	});
	const asking = joinContext(true);
	await expectClosedFailure(
		join_({ projectId: "core" }, asking.ctx),
		"RESOURCE_UNAVAILABLE",
		"Issue tools are unavailable for this session.",
	);
	expect(asking.asked).toEqual([]);
});
