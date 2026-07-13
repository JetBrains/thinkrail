// Tier-1 deterministic verdicts — the BINDING pass/fail vocabulary, evaluated after the run against the
// frozen event log + workspace. Never calls a model: fully reproducible given the same log.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EventLog } from "./events";
import { matchesToolCall, type ToolCallMatcher } from "./signals";

export interface CheckContext {
	log: EventLog;
	cwd: string;
}

export interface CheckResult {
	name: string;
	pass: boolean;
	detail: string;
	tag?: "activation" | "outcome";
}

export interface Check {
	name: string;
	tag?: "activation" | "outcome";
	run: (ctx: CheckContext) => CheckResult;
}

function result(
	name: string,
	pass: boolean,
	detail: string,
	tag?: "activation" | "outcome",
): CheckResult {
	return { name, pass, detail, tag };
}

function pathOf(args: Record<string, unknown>): string {
	return String(args.path ?? args.file_path ?? "");
}

export const checks = {
	/** The skill was loaded (its SKILL.md read). */
	expectSkillRead(name: string): Check {
		const checkName = `skill "${name}" read`;
		return {
			name: checkName,
			tag: "activation",
			run: ({ log }) => {
				const reads = log.skillReads();
				return result(
					checkName,
					reads.includes(name),
					`skills read: [${reads.join(", ")}]`,
					"activation",
				);
			},
		};
	},

	/** None of these skills were loaded. */
	expectNoSkillRead(names: string[]): Check {
		const checkName = `no skill of [${names.join(", ")}] read`;
		return {
			name: checkName,
			tag: "activation",
			run: ({ log }) => {
				const reads = log.skillReads();
				const offenders = names.filter((n) => reads.includes(n));
				return result(
					checkName,
					offenders.length === 0,
					`skills read: [${reads.join(", ")}]`,
					"activation",
				);
			},
		};
	},

	/** Skill `first` was loaded before skill `second` (router before worker). */
	expectOrdering(first: string, second: string): Check {
		const checkName = `skill "${first}" read before "${second}"`;
		return {
			name: checkName,
			tag: "activation",
			run: ({ log }) => {
				const reads = log.skillReads();
				const a = reads.indexOf(first);
				const b = reads.indexOf(second);
				return result(
					checkName,
					a !== -1 && b !== -1 && a < b,
					`order: [${reads.join(", ")}]`,
					"activation",
				);
			},
		};
	},

	expectToolCalled(name: string, matcher?: ToolCallMatcher): Check {
		const checkName = `tool ${name} called`;
		return {
			name: checkName,
			tag: "outcome",
			run: ({ log }) => {
				const calls = log.toolCalls(name).filter((call) => matchesToolCall(call, matcher));
				return result(checkName, calls.length > 0, `${calls.length} matching call(s)`, "outcome");
			},
		};
	},

	expectToolNotCalled(name: string, matcher?: ToolCallMatcher): Check {
		const checkName = `tool ${name} not called`;
		return {
			name: checkName,
			tag: "outcome",
			run: ({ log }) => {
				const calls = log.toolCalls(name).filter((call) => matchesToolCall(call, matcher));
				return result(
					checkName,
					calls.length === 0,
					calls.length === 0
						? "not called"
						: `${calls.length} offending call(s): ${calls.map((c) => pathOf(c.args)).join(", ")}`,
					"outcome",
				);
			},
		};
	},

	/** The file exists (and matches, when a matcher is given). */
	expectFile(relative: string, matcher?: RegExp | ((content: string) => boolean)): Check {
		const checkName = `file ${relative}${matcher ? " matches" : " exists"}`;
		return {
			name: checkName,
			tag: "outcome",
			run: ({ cwd }) => {
				const path = join(cwd, relative);
				if (!existsSync(path)) return result(checkName, false, "missing", "outcome");
				if (!matcher) return result(checkName, true, "exists", "outcome");
				const content = readFileSync(path, "utf8");
				const pass = matcher instanceof RegExp ? matcher.test(content) : matcher(content);
				return result(checkName, pass, pass ? "matches" : "content does not match", "outcome");
			},
		};
	},

	/** The file is a well-formed spec: frontmatter parses and carries `id` + `type`. */
	expectSpecValid(relative: string): Check {
		const checkName = `spec ${relative} valid`;
		return {
			name: checkName,
			tag: "outcome",
			run: ({ cwd }) => {
				const path = join(cwd, relative);
				if (!existsSync(path)) return result(checkName, false, "missing", "outcome");
				const content = readFileSync(path, "utf8");
				const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
				if (!frontmatter?.[1]) return result(checkName, false, "no frontmatter block", "outcome");
				const hasId = /^id:\s*\S+/m.test(frontmatter[1]);
				const hasType = /^type:\s*\S+/m.test(frontmatter[1]);
				return result(
					checkName,
					hasId && hasType,
					`id: ${hasId ? "present" : "MISSING"}, type: ${hasType ? "present" : "MISSING"}`,
					"outcome",
				);
			},
		};
	},

	/** Escape hatch — any predicate over the frozen log + workspace. */
	custom(
		name: string,
		run: (ctx: CheckContext) => boolean,
		detail = "",
		tag?: "activation" | "outcome",
	): Check {
		return {
			name,
			tag,
			run: (ctx) => result(name, run(ctx), detail, tag),
		};
	},
};

/** Evaluate all checks; the scenario asserts every result passes. */
export function runChecks(checkList: Check[], ctx: CheckContext): CheckResult[] {
	return checkList.map((check) => check.run(ctx));
}
