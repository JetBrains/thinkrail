import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	printStartupMark,
	renderStartupMark,
	type StartupMarkOutput,
	shouldPrintStartupMark,
} from "./startupMark";

const HOST_READY = {
	status: "host ready",
	endpoint: "http://localhost:24242",
} as const;

function contentLines(output: string): string[] {
	expect(output.endsWith("\n\n")).toBe(true);
	return output.slice(0, -2).split("\n");
}

function stripAnsi(value: string): string {
	const escapeCharacter = String.fromCharCode(27);
	return value.replace(new RegExp(`${escapeCharacter}\\[[0-9;]*m`, "g"), "");
}

test("wide plain output pins the approved recursive host lockup", () => {
	const output = renderStartupMark({ ...HOST_READY, columns: 80 });
	const lines = contentLines(output);

	expect(lines).toHaveLength(20);
	expect(lines[0]).toBe("THINKRAIL·THINKRAIL·THIN RAIL·THINK");
	expect(lines[6]).toEndWith("THINKRAIL");
	expect(lines[7]).toEndWith("worktree IDE for pi");
	expect(lines[10]).toEndWith("● host ready");
	expect(lines[11]).toEndWith("  localhost:24242");
	expect(Math.max(...lines.map((line) => Array.from(line).length))).toBeLessThanOrEqual(80);
	// One digest pins every space and glyph without duplicating the 42×20 artwork in the test fixture.
	expect(createHash("sha256").update(output).digest("hex")).toBe(
		"ddcb60ce1cbca6846bd6d4b78b701ff6f1d3c00224658722cdae3b4840bee93e",
	);
});

test("medium terminals stack the identity below the complete mark", () => {
	const lines = contentLines(
		renderStartupMark({ status: "starting", endpoint: "http://localhost:24269/", columns: 60 }),
	);

	expect(lines).toHaveLength(26);
	expect(lines[19]).toEndWith("RAIL·");
	expect(lines[20]).toBe("");
	expect(lines.slice(21)).toEqual([
		"THINKRAIL",
		"worktree IDE for pi",
		"",
		"● starting",
		"  localhost:24269",
	]);
	expect(Math.max(...lines.map((line) => Array.from(line).length))).toBeLessThanOrEqual(60);
});

test("very narrow terminals use the identity without wrapping the artwork", () => {
	const lines = contentLines(
		renderStartupMark({
			status: "starting",
			endpoint: "http://a-very-long-host.example:24269",
			columns: 24,
		}),
	);

	expect(lines).toEqual([
		"THINKRAIL",
		"worktree IDE for pi",
		"",
		"● starting",
		"  a-very-long-host.exam…",
	]);
	expect(lines.every((line) => Array.from(line).length <= 24)).toBe(true);
});

test("ANSI styling preserves the exact visible composition", () => {
	const plain = renderStartupMark({ ...HOST_READY, columns: 80 });
	const colored = renderStartupMark({ ...HOST_READY, columns: 80, color: true });

	expect(colored).toContain("\x1b[32m");
	expect(colored).toContain("\x1b[92m");
	expect(colored).toContain("\x1b[2;32m");
	expect(colored).toContain("\x1b[0;2m");
	expect(stripAnsi(colored)).toBe(plain);
});

test("the output gate is interactive-only", () => {
	expect(shouldPrintStartupMark({ isTTY: true })).toBe(true);
	expect(shouldPrintStartupMark({ isTTY: false })).toBe(false);
	expect(shouldPrintStartupMark({})).toBe(false);
});

test("print writes once and respects NO_COLOR and TERM=dumb", () => {
	for (const environment of [{ NO_COLOR: "" }, { TERM: "dumb" }]) {
		const writes: string[] = [];
		const output: StartupMarkOutput = {
			isTTY: true,
			columns: 80,
			write(chunk) {
				writes.push(chunk);
			},
		};

		expect(printStartupMark(HOST_READY, output, environment)).toBe(true);
		expect(writes).toHaveLength(1);
		expect(writes[0]).not.toContain("\x1b[");
	}
});

test("print omits the mark from redirected output", () => {
	const writes: string[] = [];
	const output: StartupMarkOutput = {
		isTTY: false,
		columns: 80,
		write(chunk) {
			writes.push(chunk);
		},
	};

	expect(printStartupMark(HOST_READY, output, {})).toBe(false);
	expect(writes).toEqual([]);
});
