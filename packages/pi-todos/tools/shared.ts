import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AgentToolResult,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionContext,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import {
	flatItems,
	groupStatus,
	type Todo,
	type TodoGroup,
	type TodoPlan,
	TodoStore,
} from "../core/index.ts";

export function storeFor(ctx: ExtensionContext): TodoStore {
	return new TodoStore(ctx.cwd, ctx.sessionManager.getSessionId());
}

export async function textResult<T>(
	text: string,
	details: T,
	continuation = "",
): Promise<AgentToolResult<T>> {
	if (continuation) text += `\n${continuation}`;
	const preview = truncateHead(text);
	if (!preview.truncated) return { content: [{ type: "text", text }], details };
	let fullOutputPath: string | undefined;
	let notice: string;
	try {
		const directory = await mkdtemp(join(tmpdir(), "pi-todo-output-"));
		const path = join(directory, "output.txt");
		await writeFile(path, text, { mode: 0o600 });
		fullOutputPath = path;
		notice = `Full output saved to: ${path}\nTemporary file; may expire. Read only relevant offset/limit ranges; use shell byte ranges for oversized single lines.`;
	} catch {
		notice =
			"Full output unavailable: temporary-file capture failed. Read the current plan with todo_list; do not repeat a mutation to retrieve its output.";
	}
	const footer = `\n\n[Output truncated: ${preview.totalLines} lines, ${preview.totalBytes} bytes total. ${notice}]${continuation ? `\n${continuation}` : ""}`;
	const bounded = truncateHead(text, {
		maxBytes: Math.max(0, DEFAULT_MAX_BYTES - Buffer.byteLength(footer)),
		maxLines: DEFAULT_MAX_LINES - footer.split("\n").length,
	});
	return {
		content: [{ type: "text", text: `${bounded.content}${footer}` }],
		details: {
			...details,
			output: {
				truncated: true,
				...(fullOutputPath ? { fullOutputPath } : { captureFailed: true }),
			},
		},
	};
}

export async function errorResult(message: string): Promise<AgentToolResult<{ error: string }>> {
	const inline = `Error: ${message}`;
	const text = truncateHead(inline).truncated ? `Error:\n${message}` : inline;
	return { ...(await textResult(text, { error: message })), isError: true };
}

const GLYPH: Record<Todo["status"], string> = {
	pending: "[ ]",
	in_progress: "[~]",
	done: "[x]",
};

export function formatTodo(todo: Todo): string {
	return `${GLYPH[todo.status]} ${todo.title} — ${todo.id}`;
}

export function formatGroupHeader(group: TodoGroup): string {
	const done = group.todos.filter((t) => t.status === "done").length;
	return `▸ ${group.title} [${groupStatus(group)} ${done}/${group.todos.length}]`;
}

export function formatPlan(plan: TodoPlan): string {
	const lines: string[] = [];
	for (const group of plan.groups) {
		lines.push(formatGroupHeader(group));
		for (const todo of group.todos) lines.push(`  ${formatTodo(todo)}`);
	}
	if (plan.todos.length > 0) {
		if (plan.groups.length > 0) lines.push("Loose queue:");
		for (const todo of plan.todos) lines.push(formatTodo(todo));
	}
	return lines.join("\n");
}

export function consistencyNudge(plan: TodoPlan): string | undefined {
	const open = flatItems(plan).filter((t) => t.status !== "done");
	if (open.length === 0 || open.some((t) => t.status === "in_progress")) return undefined;
	return "note: nothing is in_progress — flip the step you're working on.";
}

export function withNudges(text: string, ...nudges: (string | undefined)[]): string {
	const extra = nudges.filter((n): n is string => Boolean(n));
	return extra.length ? `${text}\n${extra.join("\n")}` : text;
}
