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

test("extension registers both tools without injecting global issue instructions", () => {
	const tools: Array<{ name: string; promptGuidelines?: string[] }> = [];
	const hooks: string[] = [];
	issueToolsExtension({
		registerTool: (tool: { name: string }) => tools.push(tool),
		on: (name: string) => hooks.push(name),
	} as unknown as ExtensionAPI);
	expect(tools.map((tool) => tool.name)).toEqual(["issue_context", "issue_record_summary"]);
	expect(tools.every((tool) => !tool.promptGuidelines?.length)).toBe(true);
	expect(hooks).toEqual([]);
	expect(childExtensionFactories()).not.toContain(issueToolsExtension);
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
				overrides: {},
			}),
		);
		const extension = loader
			.getExtensions()
			.extensions.find((item) => item.path === "<inline:issue-tools>");
		expect(extension).toBeDefined();
		expect([...(extension?.tools.keys() ?? [])]).toEqual(["issue_context", "issue_record_summary"]);
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
