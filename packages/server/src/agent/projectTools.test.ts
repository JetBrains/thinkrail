import { afterEach, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { childExtensionFactories, HOST_INLINE_FACTORIES } from "./extensions";
import {
	type AskToClone,
	CLONE_CHOICE,
	type ClonePlan,
	cloneQuestion,
	createOpenProjectTool,
	DENY_CHOICE,
	OPEN_PROJECT_TOOL_NAME,
	type OpenedProject,
	projectToolsExtension,
	setProjectToolsHost,
} from "./projectTools";

afterEach(() => setProjectToolsHost(null));

const ctx = { sessionManager: { getSessionId: () => "s-1" } } as unknown as ExtensionToolContext;

const project: OpenedProject = {
	projectId: "p-1",
	name: "fastify",
	slug: "fastify",
	path: "/home/me/thinkrail/fastify",
	outcome: "cloned",
};

const plan: ClonePlan = {
	kind: "clone",
	url: "https://github.com/fastify/fastify.git",
	parentPath: "~/thinkrail",
	name: "fastify",
	destination: "/home/me/thinkrail/fastify",
	notice: true,
};

const text = (result: { content: Array<{ type: string; text?: string }> }) =>
	result.content[0]?.type === "text" ? (result.content[0].text ?? "") : "";

function cloneHost(calls: string[]) {
	setProjectToolsHost({
		plan: async (sessionId, params) => {
			calls.push(`plan ${sessionId} ${params.repository}`);
			return plan;
		},
		clone: async (sessionId, given) => {
			calls.push(`clone ${sessionId} ${given.destination}`);
			return project;
		},
	});
}

test("a known project returns at once, without asking or cloning", async () => {
	const asked: string[] = [];
	setProjectToolsHost({
		plan: async () => ({ kind: "ready", project: { ...project, outcome: "open" } }),
		clone: async () => {
			throw new Error("must not clone");
		},
	});
	const ask: AskToClone = async () => {
		asked.push("ask");
		return CLONE_CHOICE;
	};
	const result = await createOpenProjectTool(ask).execute(
		"c-1",
		{ repository: "fastify/fastify" },
		undefined,
		undefined,
		ctx,
	);
	expect(asked).toEqual([]);
	expect(result.details).toEqual({ ...project, outcome: "open" });
	expect(text(result)).toContain('Already open: project "fastify"');
	expect(text(result)).toContain('start_workspace({ project: "fastify" })');
});

test("a clone asks on its own tool call first, then reports each stage and the cloned project", async () => {
	const calls: string[] = [];
	const updates: unknown[] = [];
	cloneHost(calls);
	const ask: AskToClone = async (sessionId, toolCallId, given) => {
		calls.push(`ask ${sessionId} ${toolCallId} ${given.url}`);
		return CLONE_CHOICE;
	};
	const result = await createOpenProjectTool(ask).execute(
		"c-7",
		{ repository: "fastify/fastify" },
		undefined,
		(update) => updates.push(update.details),
		ctx,
	);
	expect(calls).toEqual([
		"plan s-1 fastify/fastify",
		"ask s-1 c-7 https://github.com/fastify/fastify.git",
		"clone s-1 /home/me/thinkrail/fastify",
	]);
	expect(updates).toEqual([
		{ stage: "approval", url: plan.url, destination: plan.destination, notice: true },
		{ stage: "cloning", url: plan.url, destination: plan.destination, notice: true },
	]);
	expect(result.details).toEqual({ ...project, notice: true });
	expect(text(result)).toContain('Cloned and opened project "fastify"');
});

test("Deny, a dismissed prompt and Stop all fail the call without cloning", async () => {
	for (const answer of [DENY_CHOICE, undefined]) {
		const calls: string[] = [];
		cloneHost(calls);
		await expect(
			createOpenProjectTool(async () => answer).execute(
				"c-1",
				{ repository: "fastify/fastify" },
				undefined,
				undefined,
				ctx,
			),
		).rejects.toThrow("did not approve cloning https://github.com/fastify/fastify.git");
		expect(calls).toEqual(["plan s-1 fastify/fastify"]);
	}
	const calls: string[] = [];
	cloneHost(calls);
	const controller = new AbortController();
	await expect(
		createOpenProjectTool(async () => {
			controller.abort();
			return CLONE_CHOICE;
		}).execute("c-1", { repository: "fastify/fastify" }, controller.signal, undefined, ctx),
	).rejects.toThrow("Stopped; nothing was cloned.");
	expect(calls).toEqual(["plan s-1 fastify/fastify"]);
});

test("the first clone's question names the default folder and where to change it", () => {
	expect(cloneQuestion(plan)).toBe(
		"Clone https://github.com/fastify/fastify.git into /home/me/thinkrail/fastify? This is your default projects folder; you can change it in Settings › Workspaces › Projects folder.",
	);
	expect(cloneQuestion({ ...plan, notice: false })).toBe(
		"Clone https://github.com/fastify/fastify.git into /home/me/thinkrail/fastify?",
	);
});

test("open_project is a host tool for top-level chats only", () => {
	const registered: string[] = [];
	const pi = {
		registerTool: (tool: { name: string }) => registered.push(tool.name),
	} as unknown as ExtensionAPI;
	projectToolsExtension(pi);
	expect(registered).toEqual([OPEN_PROJECT_TOOL_NAME]);
	expect(HOST_INLINE_FACTORIES).toContain(projectToolsExtension);
	expect(childExtensionFactories("w1")).not.toContain(projectToolsExtension);
});

test("without a host the tool refuses instead of guessing", async () => {
	await expect(
		createOpenProjectTool(async () => CLONE_CHOICE).execute(
			"c-1",
			{ repository: "fastify/fastify" },
			undefined,
			undefined,
			ctx,
		),
	).rejects.toThrow("Opening projects is not available on this host.");
});
