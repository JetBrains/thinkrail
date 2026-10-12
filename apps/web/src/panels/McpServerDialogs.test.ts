import { expect, mock, test } from "bun:test";
import { addMcpServersWithProjectOptIn, type McpAddResult } from "./McpServerDialogs";
import { MCP_PRESETS } from "./mcpPresets";

function playwrightServer() {
	const preset = MCP_PRESETS.find((preset) => preset.id === "playwright");
	if (!preset) throw new Error("Missing Playwright preset");
	return { name: preset.name, entry: preset.entry };
}

test("the project-opt-in preset adds once before enabling the committed server", async () => {
	const server = playwrightServer();
	const results: McpAddResult[] = [{ name: server.name, error: null }];
	const order: string[] = [];
	const add = mock(async () => {
		order.push("add");
		return results;
	});
	const enable = mock(async () => {
		order.push("enable");
	});
	expect(server.entry.enabled).toBe(false);
	expect(await addMcpServersWithProjectOptIn([server], "user", add, enable)).toBe(results);
	expect(add.mock.calls).toEqual([[[server], "user"]]);
	expect(enable.mock.calls).toEqual([[server.name]]);
	expect(order).toEqual(["add", "enable"]);
});

test("an unconfirmed enable never becomes a failed add, even if its callback rejects", async () => {
	const server = playwrightServer();
	const results: McpAddResult[] = [{ name: server.name, error: null }];
	const add = mock(async () => results);
	const enable = mock(async () => {
		throw new Error("Couldn't confirm project enable");
	});
	expect(await addMcpServersWithProjectOptIn([server], "user", add, enable)).toBe(results);
	expect(results.filter((result) => result.error !== null)).toEqual([]);
	expect(add).toHaveBeenCalledTimes(1);
	expect(enable.mock.calls).toEqual([[server.name]]);
});

test("only successful adds are opted in and partial-add failures remain retryable", async () => {
	const servers = [playwrightServer(), { name: "failed", entry: { command: "fixture" } }];
	const results: McpAddResult[] = [
		{ name: "playwright", error: null },
		{ name: "failed", error: "Add refused" },
	];
	const add = mock(async () => results);
	const enable = mock(async () => {
		throw new Error("Enable refused");
	});
	const added = await addMcpServersWithProjectOptIn(servers, "user", add, enable);
	expect(added).toBe(results);
	expect(added.filter((result) => result.error !== null)).toEqual([
		{ name: "failed", error: "Add refused" },
	]);
	expect(enable.mock.calls).toEqual([["playwright"]]);
	expect(add).toHaveBeenCalledTimes(1);
});

test("an ordinary JSON add preserves each add result without project opt-in", async () => {
	const servers = [
		{ name: "saved", entry: { command: "fixture" } },
		{ name: "failed", entry: { command: "fixture" } },
	];
	const results: McpAddResult[] = [
		{ name: "saved", error: null },
		{ name: "failed", error: "Add refused" },
	];
	const add = mock(async () => results);
	expect(await addMcpServersWithProjectOptIn(servers, "project", add)).toBe(results);
	expect(add.mock.calls).toEqual([[servers, "project"]]);
});

test("a synchronous enable callback rejection also leaves the add committed", async () => {
	const server = playwrightServer();
	const results: McpAddResult[] = [{ name: server.name, error: null }];
	const add = mock(async () => results);
	const enable = mock((): Promise<void> => {
		throw new Error("Enable unavailable");
	});
	expect(await addMcpServersWithProjectOptIn([server], "user", add, enable)).toBe(results);
	expect(add).toHaveBeenCalledTimes(1);
	expect(enable).toHaveBeenCalledTimes(1);
});
