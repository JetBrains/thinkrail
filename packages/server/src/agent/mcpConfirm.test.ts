import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCurrentTools, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ExtUiRequest } from "@thinkrail/contracts";
import {
	createSession,
	disposeAllSessions,
	getSessionMessages,
	promptSession,
	setSessionManagerFactory,
	settleSessionsForShutdown,
	steerSession,
} from "./agentSessionManager";
import { MCP_CONFIRM_CHAT, MCP_CONFIRM_DENY, MCP_CONFIRM_ONCE } from "./mcp";
import { configurePiRuntime } from "./piRuntime";
import { resolveExtUi, setExtUiPublisher } from "./webUiContext";

const model = {
	id: "confirm",
	name: "confirm",
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 4096,
};
const faux = createFauxCore({
	provider: "confirm",
	api: "confirm",
	models: [model],
	tokensPerSecond: 4000,
});
const saved = {
	agent: process.env.PI_CODING_AGENT_DIR,
	data: process.env.THINKRAIL_DATA_DIR,
	offline: process.env.PI_OFFLINE,
};
const root = mkdtempSync(join(tmpdir(), "mcp-confirm-"));
const agentDir = join(root, "agent");
const registerMarker = join(root, "REGISTER_SERVER");
let requests: ExtUiRequest[] = [];
let sequence = 0;

beforeAll(async () => {
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.THINKRAIL_DATA_DIR = join(root, "data");
	process.env.PI_OFFLINE = "1";
	mkdirSync(join(agentDir, "extensions"), { recursive: true });
	const tool = (name: string, text: string, readOnly: boolean) =>
		[
			"  pi.registerTool({",
			`    name: ${JSON.stringify(name)}, label: ${JSON.stringify(name)}, description: "probe",`,
			'    parameters: { type: "object", properties: {} },',
			readOnly ? "    annotations: { readOnlyHint: true }," : "",
			`    execute: async () => ({ content: [{ type: "text", text: ${JSON.stringify(text)} }], details: {} }),`,
			"  });",
		].join("\n");
	writeFileSync(
		join(agentDir, "extensions", "mcp-probe.ts"),
		[
			'import { existsSync } from "node:fs";',
			"export default function probe(pi) {",
			tool("mcp__probe__write", "WROTE", false),
			tool("mcp__probe__read", "READ", true),
			`  if (existsSync(${JSON.stringify(registerMarker)}))`,
			'    pi.registerMcpServer("registered", { url: "https://registered.example/mcp" });',
			"}",
			"",
		].join("\n"),
	);
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("confirm", {
		api: faux.api,
		apiKey: "test",
		baseUrl: "http://faux.local",
		streamSimple: faux.streamSimple,
		models: [{ ...model, api: faux.api }],
	});
	configurePiRuntime(runtime);
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
	setExtUiPublisher((request) => requests.push(request));
});

beforeEach(() => {
	requests = [];
	rmSync(registerMarker, { force: true });
});

afterAll(async () => {
	setExtUiPublisher(() => {});
	await settleSessionsForShutdown();
	disposeAllSessions();
	configurePiRuntime(null);
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = saved.agent;
	if (saved.data === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = saved.data;
	if (saved.offline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = saved.offline;
	rmSync(root, { recursive: true, force: true });
});

async function waitFor<T>(read: () => T | undefined, ms = 8000): Promise<T> {
	const until = Date.now() + ms;
	for (;;) {
		const value = read();
		if (value !== undefined) return value;
		if (Date.now() > until) throw new Error("condition timed out");
		await Bun.sleep(5);
	}
}

const selects = () => requests.filter((request) => request.kind === "select");

async function chat() {
	const workspaceId = `confirm-${++sequence}`;
	const cwd = mkdtempSync(join(root, "cwd-"));
	const { sessionId } = await createSession({ workspaceId, cwd });
	return { workspaceId, cwd, sessionId };
}

function callTools(...names: string[]) {
	faux.setResponses([
		...names.map((name, index) =>
			fauxAssistantMessage(fauxToolCall(name, {}, { id: `call-${index}` })),
		),
		fauxAssistantMessage("DONE"),
		fauxAssistantMessage("DONE"),
	]);
}

async function toolResults(p: Awaited<ReturnType<typeof chat>>) {
	const { messages } = await getSessionMessages(p.sessionId, p.workspaceId, p.cwd);
	return messages.flatMap((message) =>
		message.role === "toolResult"
			? [
					{
						tool: message.toolName,
						isError: message.isError,
						text: message.content
							.map((block) => (block.type === "text" ? block.text : ""))
							.join(""),
					},
				]
			: [],
	);
}

async function answerNextSelect(value: string | null, index: number): Promise<ExtUiRequest> {
	const request = await waitFor(() => selects()[index]);
	resolveExtUi({ id: request.id, value });
	return request;
}

test("read-only MCP tools run unasked; others ask with Deny kept away from Allow in this chat", async () => {
	const p = await chat();
	callTools("mcp__probe__read", "mcp__probe__write");
	const turn = promptSession(p.sessionId, "Use the tools.");
	const asked = await answerNextSelect(MCP_CONFIRM_ONCE, 0);
	await turn;
	expect(asked).toMatchObject({
		kind: "select",
		options: [MCP_CONFIRM_DENY, MCP_CONFIRM_ONCE, MCP_CONFIRM_CHAT],
	});
	expect(asked.kind === "select" && asked.title).toContain("probe/write");
	expect(selects()).toHaveLength(1);
	expect(await toolResults(p)).toEqual([
		{ tool: "mcp__probe__read", isError: false, text: "READ" },
		{ tool: "mcp__probe__write", isError: false, text: "WROTE" },
	]);
});

test("Allow once asks again next time; Allow in this chat stops asking for that tool in that chat", async () => {
	const p = await chat();
	callTools("mcp__probe__write", "mcp__probe__write", "mcp__probe__write");
	const turn = promptSession(p.sessionId, "Write three times.");
	await answerNextSelect(MCP_CONFIRM_ONCE, 0);
	await answerNextSelect(MCP_CONFIRM_CHAT, 1);
	await turn;
	expect(selects()).toHaveLength(2);
	expect((await toolResults(p)).map((result) => result.text)).toEqual(["WROTE", "WROTE", "WROTE"]);

	const other = await chat();
	callTools("mcp__probe__write");
	const otherTurn = promptSession(other.sessionId, "Write.");
	await answerNextSelect(MCP_CONFIRM_ONCE, 2);
	await otherTurn;
});

test("Deny and a dismissed dialog both block the call with a reason", async () => {
	const p = await chat();
	callTools("mcp__probe__write", "mcp__probe__write");
	const turn = promptSession(p.sessionId, "Write twice.");
	await answerNextSelect(MCP_CONFIRM_DENY, 0);
	await answerNextSelect(null, 1);
	await turn;
	const results = await toolResults(p);
	expect(results.map((result) => result.isError)).toEqual([true, true]);
	expect(results[0]?.text).toContain("denied");
	expect(results[1]?.text).toContain("dismissed");
});

test("an accepted steer cancels a pending confirmation, dismisses it and blocks the call", async () => {
	const p = await chat();
	callTools("mcp__probe__write");
	const turn = promptSession(p.sessionId, "Write.");
	const asked = await waitFor(() => selects()[0]);
	await steerSession(p.sessionId, "Never mind, stop.");
	await turn;
	expect(requests).toContainEqual(expect.objectContaining({ id: asked.id, kind: "dismiss" }));
	const [result] = await toolResults(p);
	expect(result).toMatchObject({ tool: "mcp__probe__write", isError: true });
	expect(result?.text).toContain("cancelled");
});

test("the built-in tool_search is activated only when an extension registered an MCP server", async () => {
	const seenTools: string[][] = [];
	const respond = () =>
		faux.setResponses([
			(context) => {
				seenTools.push(getCurrentTools(context.messages).map((tool) => tool.name));
				return fauxAssistantMessage("OK");
			},
		]);
	const plain = await chat();
	respond();
	await promptSession(plain.sessionId, "Hi.");
	writeFileSync(registerMarker, "");
	const registered = await chat();
	respond();
	await promptSession(registered.sessionId, "Hi.");
	expect(seenTools[0]).not.toContain("tool_search");
	expect(seenTools[1]).toContain("tool_search");
});
