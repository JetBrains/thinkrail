import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	RegisteredCommand,
} from "@earendil-works/pi-coding-agent";
import sessionInsights, { createSessionInsightsExtension } from "./extension.ts";
import { tempDir } from "./test/builders.ts";
import { ALPHA, writeInsightsCorpus } from "./test/corpus.ts";

process.env.TZ = "UTC";

const agentDir = tempDir("extension");
writeInsightsCorpus(agentDir);
afterAll(() => rmSync(agentDir, { recursive: true, force: true }));

type Command = Omit<RegisteredCommand, "name" | "sourceInfo">;

function load(factory = createSessionInsightsExtension({ agentDir })) {
	const commands = new Map<string, Command>();
	const events = new Map<string, (() => void)[]>();
	const pi = {
		registerCommand: (name: string, options: Command) => commands.set(name, options),
		on: (event: string, handler: () => void) =>
			events.set(event, [...(events.get(event) ?? []), handler]),
	};
	factory(pi as unknown as ExtensionAPI);
	return { commands, events };
}

interface Seen {
	notes: { text: string; level: string | undefined }[];
	statuses: (string | undefined)[];
}

function context(
	seen: Seen,
	options: { hasUI?: boolean; window?: number } = {},
): ExtensionCommandContext {
	const ctx = {
		mode: options.hasUI === false ? "print" : "tui",
		hasUI: options.hasUI ?? true,
		cwd: ALPHA,
		ui: {
			notify: (text: string, level?: string) => seen.notes.push({ text, level }),
			setStatus: (_key: string, text: string | undefined) => seen.statuses.push(text),
		},
		modelRegistry: {
			find: () => (options.window ? { contextWindow: options.window } : undefined),
		},
	};
	return ctx as unknown as ExtensionCommandContext;
}

async function invoke(args: string, options: { hasUI?: boolean; window?: number } = {}) {
	const { commands } = load();
	const seen: Seen = { notes: [], statuses: [] };
	await commands.get("insights")?.handler(args, context(seen, options));
	return seen;
}

describe("the /insights pi extension", () => {
	test("registers one command, no tools, and drops its warm state when the session shuts down", () => {
		const { commands, events } = load();
		expect([...commands.keys()]).toEqual(["insights"]);
		expect(commands.get("insights")?.description).toContain("nothing sent");
		expect(events.get("session_shutdown")?.length).toBe(1);
		expect([...load(sessionInsights).commands.keys()]).toEqual(["insights"]);
		expect([
			...load(createSessionInsightsExtension({ agentDir, command: "stats" })).commands.keys(),
		]).toEqual(["stats"]);
	});

	test("completes a started flag, keeping the words before and skipping flags already given", async () => {
		const complete = load().commands.get("insights")?.getArgumentCompletions;
		expect(await complete?.("--a")).toEqual([
			{ value: "--all", label: "--all", description: "every folder's sessions" },
		]);
		expect((await complete?.("--all --"))?.map((item) => item.value)).toEqual([
			"--all --session",
			"--all --html",
			"--all --trace",
			"--all --help",
		]);
		expect(await complete?.("--x")).toBeNull();
		// A complete flag or no started flag offers nothing, so Enter runs the command.
		expect(await complete?.("--all")).toBeNull();
		expect(await complete?.("")).toBeNull();
		expect(await complete?.("--all ")).toBeNull();
	});

	test("interactive and RPC modes: progress in the status line, the report as a notification", async () => {
		const seen = await invoke("");
		expect(seen.notes).toHaveLength(1);
		expect(seen.notes[0]?.level).toBe("info");
		expect(seen.notes[0]?.text).toStartWith("Session insights · /work/alpha · 6 sessions");
		expect(seen.statuses.some((text) => text?.startsWith("insights: "))).toBe(true);
		expect(seen.statuses.at(-1)).toBeUndefined();
	});

	test("the context window comes from pi's model registry", async () => {
		const seen = await invoke("--session 019a4089", { window: 40_000 });
		expect(seen.notes[0]?.text).toContain(
			"peak 20k tokens of anthropic/claude-test's 40k window (50%)",
		);
	});

	test("a bad argument warns with the usage and reads nothing", async () => {
		const seen = await invoke("--frobnicate");
		expect(seen.notes).toEqual([
			{ text: expect.stringContaining("Unknown option --frobnicate."), level: "warning" },
		]);
		expect(seen.statuses).toEqual([]);
	});

	test("print and JSON modes write the report to stderr (pi keeps stdout for its own output)", async () => {
		const written: string[] = [];
		const original = process.stderr.write.bind(process.stderr);
		process.stderr.write = ((chunk: string | Uint8Array) => {
			written.push(String(chunk));
			return true;
		}) as typeof process.stderr.write;
		let seen: Seen;
		try {
			seen = await invoke("--help", { hasUI: false });
		} finally {
			process.stderr.write = original;
		}
		expect(seen.notes).toEqual([]);
		expect(written.join("")).toStartWith("Usage: /insights");
	});

	test("Node runs the same command and prints the same report as Bun", async () => {
		const node = spawnSync("node", ["--version"], { encoding: "utf8" });
		if (node.status !== 0) return;
		const seen = await invoke("--all");
		const script = join(agentDir, "node-smoke.mjs");
		writeFileSync(
			script,
			[
				"const [, , entry, agentDir, cwd] = process.argv;",
				"const { createSessionInsightsExtension } = await import(entry);",
				"let command;",
				"createSessionInsightsExtension({ agentDir })({ on() {}, registerCommand(name, options) { command = options; } });",
				"let text = '';",
				"await command.handler('--all', { hasUI: true, cwd, ui: { notify: (t) => { text = t; }, setStatus() {} } });",
				"process.stdout.write(text);",
			].join("\n"),
		);
		const run = spawnSync(
			"node",
			[script, new URL("./extension.ts", import.meta.url).href, agentDir, ALPHA],
			{ encoding: "utf8", env: { ...process.env, TZ: "UTC" } },
		);
		expect(run.stderr).toBe("");
		expect(run.status).toBe(0);
		expect(run.stdout).toBe(seen.notes[0]?.text ?? "");
	}, 60_000);
});
