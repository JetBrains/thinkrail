import { afterEach, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { childExtensionFactories } from "./extensions";
import {
	createSetTitleTool,
	pendingNamingRule,
	SET_TITLE_TOOL_NAME,
	type SetTitleParams,
	setTitleExtension,
	setTitleToolHost,
} from "./titleTool";

afterEach(() => setTitleToolHost(null));

const ctx = { sessionManager: { getSessionId: () => "s-1" } } as unknown as ExtensionToolContext;

test("set_title delegates the write policy to the host handler and returns its verdict", async () => {
	const calls: Array<[string, SetTitleParams]> = [];
	setTitleToolHost({
		apply: async (sessionId, params) => {
			calls.push([sessionId, params]);
			return "Chat title set. Workspace name kept (already named).";
		},
		workspaceNeedsName: () => false,
	});
	const params = { chat_title: "Ревью #567", workspace_name: "Review #567", branch: "review-567" };
	const result = await createSetTitleTool().execute("call-1", params, undefined, undefined, ctx);

	expect(calls).toEqual([["s-1", params]]);
	expect(result.content).toEqual([
		{ type: "text", text: "Chat title set. Workspace name kept (already named)." },
	]);
});

test("the guidance names once-only, user-language, and the PR/issue form", () => {
	const tool = createSetTitleTool();
	const guidance = [tool.description, ...(tool.promptGuidelines ?? [])].join("\n");
	expect(guidance).toContain("once per conversation");
	expect(guidance).toContain("language the user writes in");
	expect(guidance).toContain("<Verb> #<number> <its exact title>");
});

test("the tool is registered for top-level sessions, never in a subagent child's factories", () => {
	const registered: string[] = [];
	const pi = {
		registerTool: (t: { name: string }) => registered.push(t.name),
		on: () => {},
	} as unknown as ExtensionAPI;
	setTitleExtension(pi);
	expect(registered).toEqual([SET_TITLE_TOOL_NAME]);
	expect(childExtensionFactories()).not.toContain(setTitleExtension);
});

test("pendingNamingRule names exactly what is still unnamed, and vanishes once both are named", () => {
	expect(pendingNamingRule(true, true)).toContain(
		"this chat has no title and its workspace has no name yet",
	);
	expect(pendingNamingRule(true, false)).toContain("this chat has no title yet");
	expect(pendingNamingRule(false, true)).toContain("its workspace has no name yet");
	expect(pendingNamingRule(false, false)).toBeNull();
});

test("the turn-start hook adds the pending-naming section only while something is unnamed", async () => {
	type Hook = (event: unknown, ctx: unknown) => void;
	let hook: Hook = () => {};
	const pi = {
		registerTool: () => {},
		on: (_name: string, fn: Hook) => {
			hook = fn;
		},
	} as unknown as ExtensionAPI;
	setTitleExtension(pi);
	let workspaceUnnamed = true;
	setTitleToolHost({ apply: async () => "", workspaceNeedsName: () => workspaceUnnamed });

	const run = (sessionName: string | undefined) => {
		const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
		hook(event, {
			sessionManager: { getSessionId: () => "s-1", getSessionName: () => sessionName },
		});
		return event.systemPromptOptions.sections["pending-naming"];
	};

	expect(run(undefined)).toContain("call set_title before your other tool calls");
	workspaceUnnamed = false;
	expect(run("Named")).toBeUndefined();
	expect(run(undefined)).toContain("this chat has no title yet");
});
