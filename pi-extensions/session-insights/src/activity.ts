import { type Activity, SUBAGENT_TOOLS, type ToolEvent } from "./core.ts";
import type { CallFacts } from "./facts.ts";
import { toolFamily } from "./toolFamily.ts";

const SHELL_TOOLS: ReadonlySet<string> = new Set(["bash", "background_command"]);
const SEARCH_TOOLS: ReadonlySet<string> = new Set(["grep", "find", "ls"]);
const EDIT_TOOLS: ReadonlySet<string> = new Set(["edit", "write"]);
const SUBAGENT: ReadonlySet<string> = new Set(SUBAGENT_TOOLS);
const WEB_TOOLS: ReadonlySet<string> = new Set([
	"web_search",
	"fetch_content",
	"get_search_content",
	"source_check",
]);
const TEST_HEAD =
	/(?:^|[\s:])(?:test|tests|vitest|jest|pytest|playwright|mocha|rspec|phpunit|ctest|e2e)(?:[\s:]|$)/;
const LINT_HEAD =
	/(?:^|[\s:])(?:lint|eslint|biome|prettier|ruff|flake8|pylint|clippy|stylelint|shellcheck|fmt|format|black|isort)(?:[\s:]|$)/;
const BUILD_HEAD =
	/(?:^|[\s:])(?:build|tsc|typecheck|compile|make|webpack|gradle|mvn|cmake)(?:[\s:]|$)/;

/**
 * A shell command by its head: tests, linters, builds, git and gh, then an edit when it writes into a
 * file, then the head's reading family.
 */
export function shellActivity(head: string | null, writes = false): Activity {
	if (head && TEST_HEAD.test(head)) return "test";
	if (head && LINT_HEAD.test(head)) return "lint";
	if (head && BUILD_HEAD.test(head)) return "build";
	const first = head?.split(" ")[0] ?? "";
	if (first === "git" || first === "gh") return "git";
	if (writes) return "edit";
	if (!head) return "run";
	switch (toolFamily("bash", head)) {
		case "discovery":
			return "search";
		case "reading":
			return "read";
		case "writing":
			return "edit";
		default:
			return "run";
	}
}

/** The activity of a tool call ([[module-pi-session-insights]] § Action sequences documents the map). */
export function activityOf(event: ToolEvent, call: CallFacts | null | undefined): Activity {
	const tool = event.tool;
	if (SHELL_TOOLS.has(tool)) return shellActivity(event.head ?? null, call?.writes === true);
	if (call?.skill) return "skill";
	if (tool === "read") return "read";
	if (SEARCH_TOOLS.has(tool)) return "search";
	if (EDIT_TOOLS.has(tool)) return "edit";
	if (tool.startsWith("todo_")) return "plan";
	if (tool.startsWith("spec_")) return "specs";
	if (SUBAGENT.has(tool)) return "subagent";
	if (tool === "ask_user_question") return "ask";
	if (WEB_TOOLS.has(tool)) return "web";
	if (tool.startsWith("mcp__") || tool.startsWith("mcp_") || tool === "mcp") return "mcp";
	return "other";
}
