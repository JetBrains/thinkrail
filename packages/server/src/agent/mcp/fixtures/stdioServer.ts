import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const pidFile = process.env.MCP_FIXTURE_PID_FILE;
if (pidFile) appendFileSync(pidFile, `${process.pid}\n`);
if (process.env.MCP_FIXTURE_STUBBORN === "1") {
	process.on("SIGTERM", () => {});
	setInterval(() => {}, 1000);
}

const tools = [
	{
		name: "echo",
		description: "Echo the text back",
		inputSchema: { type: "object", properties: { text: { type: "string" } } },
		annotations: { readOnlyHint: true },
	},
	{
		name: "write_note",
		description: "Store a note",
		inputSchema: { type: "object", properties: { text: { type: "string" } } },
	},
	{
		name: "rich",
		description: "Return text, an image, a resource link and structured content",
		inputSchema: { type: "object", properties: {} },
		annotations: { readOnlyHint: true },
	},
];

const PIXEL =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function callResult(name: string, text: string): unknown {
	if (name === "rich") {
		return {
			content: [
				{ type: "text", text: "rich result" },
				{ type: "image", data: PIXEL, mimeType: "image/png" },
				{
					type: "resource_link",
					uri: "file:///notes/a.md",
					name: "a.md",
					mimeType: "text/markdown",
				},
			],
			structuredContent: { rows: [{ id: 1, title: "first" }] },
		};
	}
	return { content: [{ type: "text", text: `${name}: ${text}` }] };
}

function reply(id: unknown, result: unknown): void {
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
	let message: { id?: unknown; method?: string; params?: Record<string, unknown> };
	try {
		message = JSON.parse(line);
	} catch {
		return;
	}
	if (message.id === undefined) return;
	switch (message.method) {
		case "initialize":
			return reply(message.id, {
				protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
				capabilities: { tools: {} },
				serverInfo: { name: "fixture", version: "1.0.0" },
			});
		case "tools/list":
			return reply(message.id, { tools });
		case "tools/call": {
			const args = (message.params?.arguments ?? {}) as { text?: string };
			return reply(message.id, callResult(String(message.params?.name), args.text ?? ""));
		}
		default:
			return reply(message.id, {});
	}
});
lines.on("close", () => {
	if (process.env.MCP_FIXTURE_STUBBORN !== "1") process.exit(0);
});
