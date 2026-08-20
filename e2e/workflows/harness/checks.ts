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
}

export interface Check {
	name: string;
	run: (ctx: CheckContext) => CheckResult;
}

function result(name: string, pass: boolean, detail: string): CheckResult {
	return { name, pass, detail };
}

function pathOf(args: Record<string, unknown>): string {
	return String(args.path ?? args.file_path ?? "");
}

export const checks = {
	expectSkillRead(name: string): Check {
		const checkName = `skill "${name}" read`;
		return {
			name: checkName,
			run: ({ log }) => {
				const reads = log.skillReads();
				return result(checkName, reads.includes(name), `skills read: [${reads.join(", ")}]`);
			},
		};
	},

	expectNoSkillRead(names: string[]): Check {
		const checkName = `no skill of [${names.join(", ")}] read`;
		return {
			name: checkName,
			run: ({ log }) => {
				const reads = log.skillReads();
				const offenders = names.filter((n) => reads.includes(n));
				return result(checkName, offenders.length === 0, `skills read: [${reads.join(", ")}]`);
			},
		};
	},

	expectOrdering(first: string, second: string): Check {
		const checkName = `skill "${first}" read before "${second}"`;
		return {
			name: checkName,
			run: ({ log }) => {
				const reads = log.skillReads();
				const a = reads.indexOf(first);
				const b = reads.indexOf(second);
				return result(checkName, a !== -1 && b !== -1 && a < b, `order: [${reads.join(", ")}]`);
			},
		};
	},

	expectToolCalled(name: string, matcher?: ToolCallMatcher): Check {
		const checkName = `tool ${name} called`;
		return {
			name: checkName,
			run: ({ log }) => {
				const calls = log.toolCalls(name).filter((call) => matchesToolCall(call, matcher));
				return result(checkName, calls.length > 0, `${calls.length} matching call(s)`);
			},
		};
	},

	expectToolNotCalled(name: string, matcher?: ToolCallMatcher): Check {
		const checkName = `tool ${name} not called`;
		return {
			name: checkName,
			run: ({ log }) => {
				const calls = log.toolCalls(name).filter((call) => matchesToolCall(call, matcher));
				return result(
					checkName,
					calls.length === 0,
					calls.length === 0
						? "not called"
						: `${calls.length} offending call(s): ${calls.map((c) => pathOf(c.args)).join(", ")}`,
				);
			},
		};
	},

	expectFile(relative: string, matcher?: RegExp | ((content: string) => boolean)): Check {
		const checkName = `file ${relative}${matcher ? " matches" : " exists"}`;
		return {
			name: checkName,
			run: ({ cwd }) => {
				const path = join(cwd, relative);
				if (!existsSync(path)) return result(checkName, false, "missing");
				if (!matcher) return result(checkName, true, "exists");
				const content = readFileSync(path, "utf8");
				const pass = matcher instanceof RegExp ? matcher.test(content) : matcher(content);
				return result(checkName, pass, pass ? "matches" : "content does not match");
			},
		};
	},

	expectSpecValid(relative: string): Check {
		const checkName = `spec ${relative} valid`;
		return {
			name: checkName,
			run: ({ cwd }) => {
				const path = join(cwd, relative);
				if (!existsSync(path)) return result(checkName, false, "missing");
				const content = readFileSync(path, "utf8");
				const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
				if (!frontmatter?.[1]) return result(checkName, false, "no frontmatter block");
				const hasId = /^id:\s*\S+/m.test(frontmatter[1]);
				const hasType = /^type:\s*\S+/m.test(frontmatter[1]);
				return result(
					checkName,
					hasId && hasType,
					`id: ${hasId ? "present" : "MISSING"}, type: ${hasType ? "present" : "MISSING"}`,
				);
			},
		};
	},

	custom(name: string, run: (ctx: CheckContext) => boolean, detail = ""): Check {
		return {
			name,
			run: (ctx) => result(name, run(ctx), detail),
		};
	},
};

export function runChecks(checkList: Check[], ctx: CheckContext): CheckResult[] {
	return checkList.map((check) => check.run(ctx));
}
