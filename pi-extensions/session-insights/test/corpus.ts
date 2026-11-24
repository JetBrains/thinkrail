import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cached, runDetails, TranscriptBuilder, usage, writeSession } from "./builders.ts";

/** The folders the insights corpus' sessions ran in. */
export const ALPHA = "/work/alpha";
export const BETA = "/work/beta";

const day = (date: number, hour = 10) => new Date(2026, 10, date, hour).getTime();

/** A UUIDv7-shaped id whose head differs per session, as pi's ids do minutes apart. */
export function corpusId(n: number): string {
	return `019a${(0x3b10 + n * 0x1d3).toString(16).padStart(4, "0")}-7c2e-7000-8000-${String(n).padStart(12, "0")}`;
}

function skillsSection(names: readonly string[]): string {
	return `<skills>\n<available_skills>\n${names
		.map(
			(name) =>
				`  <skill>\n    <name>${name}</name>\n    <description>Use ${name} when it applies.</description>\n  </skill>`,
		)
		.join("\n")}\n</available_skills>\n</skills>`;
}

let call = 0;

function tool(
	builder: TranscriptBuilder,
	name: string,
	args: Record<string, unknown>,
	options: { error?: boolean; text?: string; details?: unknown; cost?: number } = {},
): void {
	call += 1;
	const id = `call-${call}`;
	builder.assistant({
		toolCalls: [{ id, name, arguments: args }],
		usage: cached({ input: 2000, cacheRead: 18_000, output: 120 }, options.cost ?? 0.05),
		durationMs: 1500,
	});
	builder.toolResult({
		toolCallId: id,
		toolName: name,
		isError: options.error === true,
		text:
			options.text ??
			(options.error ? "error: expected 3 to equal 4\nCommand exited with code 1" : "ok"),
		...(options.details !== undefined ? { details: options.details } : {}),
		durationMs: 800,
	});
}

/**
 * Eight sessions under `<agentDir>/sessions`: six in /work/alpha (a failing `bun test` in three, a
 * skill listed and never loaded, a reworked file, a cost outlier, a subagent with its transcript in the
 * vanilla delegation folder) and two in /work/beta (one with no recorded cost). Returns the ids.
 */
export function writeInsightsCorpus(agentDir: string): { alpha: string[]; beta: string[] } {
	const sessions = join(agentDir, "sessions");
	const alpha: string[] = [];
	const beta: string[] = [];
	const session = (n: number, cwd: string, date: number, title?: string) => {
		const builder = new TranscriptBuilder({ id: corpusId(n), cwd, start: day(date) });
		if (title) builder.sessionInfo(title);
		return builder;
	};
	const save = (builder: TranscriptBuilder, cwd: string) => {
		writeSession(sessions, `--${cwd.replace(/^\//, "").replace(/\//g, "-")}--`, builder);
		(cwd === ALPHA ? alpha : beta).push(builder.id);
	};

	for (let n = 1; n <= 3; n++) {
		const builder = session(n, ALPHA, n + 2, n === 1 ? "Fix the flaky parser test" : undefined);
		if (n === 2)
			builder.system({ sections: { skills: skillsSection(["brainstorming", "tdd", "release"]) } });
		builder.user(`Make the parser tests pass, round ${n}`);
		if (n === 2) tool(builder, "read", { path: "/home/me/.pi/agent/skills/tdd/SKILL.md" });
		tool(builder, "read", { path: `${ALPHA}/src/parser.ts` });
		tool(builder, "bash", { command: "bun test src/parser.test.ts" }, { error: true });
		tool(builder, "edit", { path: `${ALPHA}/src/parser.ts`, edits: [] });
		tool(builder, "bash", { command: "bun test src/parser.test.ts" }, { error: true });
		tool(builder, "bash", { command: "bun test src/parser.test.ts" });
		if (n === 3) {
			tool(
				builder,
				"Agent",
				{ subagent_type: "scout", task: "Find where the tokenizer drops quotes" },
				{ details: runDetails("kid-1", "completed", { tokens: 4000, cost: 0.42 }, 90_000) },
			);
			const child = new TranscriptBuilder({ id: "kid-1", cwd: ALPHA, start: day(n + 2, 11) });
			child.user("Find where the tokenizer drops quotes");
			child.assistant({ text: "In tokenize().", usage: usage(1000, 0.42) });
			const dir = join(agentDir, "delegation", "default", builder.id);
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "kid-1.jsonl"), child.text());
		}
		builder.assistant({ text: "The parser tests pass now.", usage: cached({ input: 500 }, 0.1) });
		save(builder, ALPHA);
	}

	const rework = session(4, ALPHA, 6, "Refactor the app shell");
	rework.user("Split the app shell into panels");
	for (let edit = 0; edit < 6; edit++)
		tool(rework, "edit", { path: `${ALPHA}/src/app.ts`, edits: [] });
	rework.assistant({ text: "Done.", usage: cached({ input: 500 }, 0.1) });
	save(rework, ALPHA);

	const small = session(5, ALPHA, 7);
	small.user("What does the build script do?");
	tool(small, "read", { path: `${ALPHA}/package.json` });
	small.assistant({ text: "It bundles the app.", usage: cached({ input: 500 }, 0.1) });
	save(small, ALPHA);

	const costly = session(6, ALPHA, 8, "Migrate the storage layer");
	costly.user("Migrate the storage layer to the new schema");
	for (let step = 0; step < 4; step++)
		tool(costly, "read", { path: `${ALPHA}/src/storage/${step}.ts` }, { cost: 1.4 });
	costly.assistant({
		text: "Migrated.",
		usage: cached({ input: 1000, cacheWrite: 120_000 }, 1.5),
	});
	save(costly, ALPHA);

	const notes = session(7, BETA, 9, "Write release notes");
	notes.user("Draft the release notes");
	tool(notes, "bash", { command: "git log --oneline -20" });
	notes.assistant({ text: "Drafted.", usage: cached({ input: 400 }, 0.08) });
	save(notes, BETA);

	const bridge = session(8, BETA, 10);
	bridge.user("Summarize the open issues");
	bridge.assistant({
		text: "Three are open.",
		provider: "claude-bridge",
		model: "opus",
		usage: cached({ input: 3000, output: 400 }, 0),
	});
	save(bridge, BETA);
	return { alpha, beta };
}
