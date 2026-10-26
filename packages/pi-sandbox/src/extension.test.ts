import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSandboxExtension } from "./extension";
import type { SandboxPolicy } from "./policy";

const policy: SandboxPolicy = {
	allowWrite: ["/work"],
	denyRead: ["/sandbox-home/.ssh"],
	allowRead: [],
	denyWrite: [],
	allowedDomains: [],
	allowLocalBinding: true,
	systemTrust: false,
};

function load() {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const tools: string[] = [];
	const pi = {
		registerTool: (tool: { name: string }) => tools.push(tool.name),
		on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) =>
			handlers.set(name, handler),
	} as unknown as ExtensionAPI;
	createSandboxExtension({ policyFor: () => policy })(pi);
	const call = (toolName: string, path?: string) =>
		handlers.get("tool_call")?.({ type: "tool_call", toolName, input: { path } }, { cwd: "/work" });
	return { tools, handlers, call };
}

test("replaces the built-in bash tool and routes user shell commands", () => {
	const { tools, handlers } = load();
	expect(tools).toEqual(["bash"]);
	expect(handlers.has("user_bash")).toBe(true);
});

test("file tools are held to the same policy as the shell", () => {
	const { call } = load();
	expect(call("write", "src/a.ts")).toBeUndefined();
	expect(call("edit", "/etc/hosts")).toMatchObject({ block: true });
	expect(call("read", "/sandbox-home/.ssh/id_rsa")).toMatchObject({ block: true });
	expect(call("grep")).toBeUndefined();
	expect(call("some_extension_tool", "/etc/hosts")).toBeUndefined();
});
