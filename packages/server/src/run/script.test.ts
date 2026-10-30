import { describe, expect, test } from "bun:test";
import {
	composeRunScript,
	discoverLoopbackUrl,
	resolveUrl,
	shellQuote,
	stripAnsi,
	urlPort,
} from "./script";

describe("composeRunScript", () => {
	test("echoes and runs prepare commands, writes the sentinel, then runs the target last", () => {
		const script = composeRunScript({
			prepare: ["bun install", '[ -f .env ] || cp "$THINKRAIL_RUN_DEFAULT_WORKTREE/.env" .env'],
			target: { command: "FOO=1 bun run dev && echo done", cwd: "apps/web" },
			preparedSentinel: "/tmp/run/it's-ready",
		});
		expect(script.split("\n")).toEqual([
			"set -e",
			"printf '\\033[2m$ %s\\033[0m\\n' 'bun install'",
			"bun install",
			"printf '\\033[2m$ %s\\033[0m\\n' '[ -f .env ] || cp \"$THINKRAIL_RUN_DEFAULT_WORKTREE/.env\" .env'",
			'[ -f .env ] || cp "$THINKRAIL_RUN_DEFAULT_WORKTREE/.env" .env',
			": > '/tmp/run/it'\\''s-ready'",
			"cd 'apps/web'",
			"printf '\\033[2m$ %s\\033[0m\\n' 'FOO=1 bun run dev && echo done'",
			"FOO=1 bun run dev && echo done",
			"",
		]);
	});

	test("a prepare-only script has no target and the default cwd adds no cd", () => {
		expect(composeRunScript({ prepare: ["true"], preparedSentinel: "/s" })).toBe(
			"set -e\nprintf '\\033[2m$ %s\\033[0m\\n' 'true'\ntrue\n: > '/s'\n",
		);
		expect(
			composeRunScript({ prepare: [], target: { command: "x", cwd: "." }, preparedSentinel: "/s" }),
		).not.toContain("cd ");
	});

	test("shellQuote survives quotes and newlines", () => {
		expect(shellQuote("it's\nmulti")).toBe("'it'\\''s\nmulti'");
	});
});

describe("output helpers", () => {
	test("stripAnsi removes CSI, OSC and bare escapes and applies carriage returns", () => {
		expect(stripAnsi("\u001b[2m$ bun\u001b[0m\n\u001b]0;title\u0007ready\r\n")).toBe(
			"$ bun\nready\n",
		);
		expect(stripAnsi("progress 1\rprogress 2\n")).toBe("progress 2\n");
		expect(stripAnsi("\u001b(Bplain")).toBe("plain");
	});

	test("discoverLoopbackUrl finds the first loopback URL in colored output", () => {
		expect(discoverLoopbackUrl("  ➜  Local:   \u001b[36mhttp://localhost:5174/\u001b[0m\n")).toBe(
			"http://localhost:5174/",
		);
		expect(discoverLoopbackUrl("listening on http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
		expect(discoverLoopbackUrl("see https://example.com/docs")).toBeNull();
	});

	test("resolveUrl and urlPort", () => {
		expect(resolveUrl(`http://localhost:\${PORT}/app`, { PORT: 5174 })).toBe(
			"http://localhost:5174/app",
		);
		expect(urlPort("http://localhost:5174/")).toBe(5174);
		expect(urlPort("http://localhost/")).toBe(80);
		expect(urlPort("not a url")).toBeNull();
	});
});
