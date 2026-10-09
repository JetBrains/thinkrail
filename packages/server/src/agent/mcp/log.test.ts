import { expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mcpServerLogLines } from "./log";

const piDist = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const piLog = (await import(join(piDist, "extensions", "mcp", "log.js"))) as {
	formatMcpLogMessage: (server: string, params: unknown, now?: Date) => string;
};

const LOG = [
	"2026-10-08T09:00:00.000Z [docs] info starting",
	"2026-10-08T09:00:01.000Z [docs-two] warning other server",
	"2026-10-08T09:00:02.000Z [docs] error fetch: failed",
	"    at connect (index.js:1)",
	"    ",
	"2026-10-08T09:00:03.000Z [other] info [docs] mentioned by another server",
	"    continuation of other",
	"stray line from a torn write",
	"    stray continuation",
	"",
].join("\n");

test("a server's log keeps its own entries and their continuation lines, never another server's", () => {
	expect(mcpServerLogLines(LOG, "docs")).toEqual([
		"2026-10-08T09:00:00.000Z [docs] info starting",
		"2026-10-08T09:00:02.000Z [docs] error fetch: failed",
		"    at connect (index.js:1)",
		"    ",
	]);
	expect(mcpServerLogLines(LOG, "docs-two")).toEqual([
		"2026-10-08T09:00:01.000Z [docs-two] warning other server",
	]);
	expect(mcpServerLogLines(LOG, "missing")).toEqual([]);
	expect(mcpServerLogLines("", "docs")).toEqual([]);
});

test("the parser reads pi's own log format, multi-line messages included", () => {
	const at = new Date("2026-10-08T09:00:00.000Z");
	const text = [
		piLog.formatMcpLogMessage(
			"docs",
			{ level: "error", logger: "net", data: "down\nretrying" },
			at,
		),
		piLog.formatMcpLogMessage("other", { data: { ok: true } }, at),
		piLog.formatMcpLogMessage("docs", "plain", at),
	].join("");
	expect(mcpServerLogLines(text, "docs")).toEqual([
		"2026-10-08T09:00:00.000Z [docs] error net: down",
		"    retrying",
		"2026-10-08T09:00:00.000Z [docs] info plain",
	]);
});

test("only the latest lines are kept", () => {
	const many = Array.from(
		{ length: 5 },
		(_, index) => `2026-10-08T09:00:0${index}.000Z [docs] info line ${index}`,
	).join("\n");
	expect(mcpServerLogLines(many, "docs", 2)).toEqual([
		"2026-10-08T09:00:03.000Z [docs] info line 3",
		"2026-10-08T09:00:04.000Z [docs] info line 4",
	]);
});
