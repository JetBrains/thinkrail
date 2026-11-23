import { describe, expect, test } from "bun:test";
import { activityOf, shellActivity } from "./activity.ts";
import type { ToolEvent } from "./core.ts";
import type { CallFacts } from "./facts.ts";
import { shellWrites } from "./toolFamily.ts";

function tool(name: string, head?: string): ToolEvent {
	return {
		kind: "tool",
		id: "t",
		parent: null,
		depth: 1,
		t0: 0,
		t1: 0,
		timing: "notMeasured",
		label: "",
		tool: name,
		family: "other",
		toolCallId: "c",
		argsChars: 0,
		resultChars: 0,
		...(head ? { head } : {}),
	};
}

const facts = (skill: string | null, writes = false): CallFacts => ({
	key: "",
	path: null,
	words: [],
	objects: [],
	skill,
	todo: null,
	edit: false,
	writes,
	file: null,
});

describe("activity families", () => {
	test.each([
		["bun test", "test"],
		["bun run e2e", "test"],
		["pytest", "test"],
		["bun run lint", "lint"],
		["bunx biome check", "lint"],
		["bun run typecheck", "build"],
		["tsc", "build"],
		["make", "build"],
		["git status", "git"],
		["gh pr view", "git"],
		["rg", "search"],
		["ls", "search"],
		["cat", "read"],
		["sed", "read"],
		["rm", "edit"],
		["mkdir", "edit"],
		["python3", "run"],
		["bun run check:deps", "run"],
	] as const)("the shell head %s is %s", (head, activity) => {
		expect(shellActivity(head)).toBe(activity);
		expect(activityOf(tool("bash", head), null)).toBe(activity);
	});

	test.each([
		["cat", "edit"],
		["sed", "edit"],
		["python3", "edit"],
		["bun test", "test"],
		["git diff", "git"],
	] as const)("the shell head %s writing into a file is %s", (head, activity) => {
		expect(shellActivity(head, true)).toBe(activity);
		expect(activityOf(tool("bash", head), facts(null, true))).toBe(activity);
	});

	test.each([
		["cat >> tests/test_cli.py <<'EOF'\nimport x > y\nEOF", true],
		["cat > notes.txt", true],
		["cat > 'my notes.txt'", true],
		["echo done >> log.txt && bun test", true],
		["bun test 2>&1 | tee out.log", true],
		["sed -i 's/a/b/' src/a.ts", true],
		["sed -i.bak -e 's/a/b/' src/a.ts", true],
		["perl -pi -e 's/a/b/' src/a.ts", true],
		["cmd 2> errors.log", true],
		["cat README.md", false],
		['echo "a > b"', false],
		["grep -rn '=>' src", false],
		["ls 2>/dev/null", false],
		["bun test >/dev/null 2>&1", false],
		["echo oops >&2", false],
		["sed -n '1,20p' src/a.ts", false],
		["cat <<EOF\na > b\nEOF", false],
		["tr a b <<< 'x > y'", false],
		["diff <(cat a) <(cat b)", false],
	] as const)("%p writes into a file: %p", (command, writes) => {
		expect(shellWrites(command)).toBe(writes);
	});

	test("a command without a head is a run", () => {
		expect(shellActivity(null)).toBe("run");
		expect(activityOf(tool("background_command"), null)).toBe("run");
	});

	test.each([
		["read", "read"],
		["grep", "search"],
		["find", "search"],
		["edit", "edit"],
		["write", "edit"],
		["todo_write", "plan"],
		["spec_search", "specs"],
		["Agent", "subagent"],
		["get_subagent_result", "subagent"],
		["ask_user_question", "ask"],
		["web_search", "web"],
		["fetch_content", "web"],
		["mcp__github__list_prs", "mcp"],
		["set_title", "other"],
	] as const)("the tool %s is %s", (name, activity) => {
		expect(activityOf(tool(name), facts(null))).toBe(activity);
	});

	test("a SKILL.md read is a skill", () => {
		expect(activityOf(tool("read"), facts("review-pr"))).toBe("skill");
	});
});
