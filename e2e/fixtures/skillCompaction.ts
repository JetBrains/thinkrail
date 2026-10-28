import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { defaultSessionDirFor } from "@thinkrail/server/history-test-fixtures";
import { waitForAgentSettled } from "./app";
import { E2E_PI_AGENT_DIR } from "./paths";

export interface ToolCall {
	name: string;
	arguments: Record<string, unknown>;
}

export interface SessionEntry {
	type: string;
	id: string;
	firstKeptEntryId?: string;
	summary?: string;
	customType?: string;
	content?: unknown;
	message?: { role: string; content?: unknown };
}

export function toolCalls(entry: SessionEntry): ToolCall[] {
	if (entry.type !== "message" || entry.message?.role !== "assistant") return [];
	const content = entry.message.content;
	if (!Array.isArray(content)) return [];
	return content.filter((part): part is ToolCall & { type: string } => part?.type === "toolCall");
}

function texts(content: unknown): string[] {
	if (typeof content === "string") return [content];
	if (!Array.isArray(content)) return [];
	return content.map((part) => String(part?.text ?? ""));
}

export function assistantText(entry: SessionEntry): string {
	if (entry.type !== "message" || entry.message?.role !== "assistant") return "";
	return texts(entry.message.content).join("");
}

export function isSkillLoad(entry: SessionEntry, skill: string): boolean {
	const block = `<skill name="${skill}"`;
	if (entry.type === "message" && entry.message?.role === "user")
		return texts(entry.message.content).some((text) => text.startsWith(block));
	if (entry.type === "custom_message") return texts(entry.content).some((t) => t.includes(block));
	const path = new RegExp(`${skill}[/\\\\]SKILL\\.md$`);
	return toolCalls(entry).some(
		(call) => call.name === "read" && path.test(String(call.arguments.path ?? "")),
	);
}

export function readSession(worktreePath: string): SessionEntry[] {
	const dirs = [worktreePath, realpathSync(worktreePath)].map((cwd) =>
		defaultSessionDirFor(E2E_PI_AGENT_DIR, cwd),
	);
	const files = dirs
		.filter((dir) => existsSync(dir))
		.flatMap((dir) =>
			readdirSync(dir)
				.filter((name) => name.endsWith(".jsonl"))
				.map((name) => join(dir, name)),
		)
		.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
	if (files.length === 0) throw new Error(`No pi session file under ${dirs.join(" or ")}`);
	return readFileSync(files[0] as string, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as SessionEntry);
}

export interface CompactionSplit {
	before: SessionEntry[];
	after: SessionEntry[];
	compaction: SessionEntry;
	skillLoadsKept: number;
	skillLoadsCompactedAway: number;
}

export function splitAtCompaction(entries: SessionEntry[], skill: string): CompactionSplit {
	const index = entries.findLastIndex((e) => e.type === "compaction");
	if (index < 0) throw new Error("The session recorded no compaction");
	const compaction = entries[index] as SessionEntry;
	const kept = entries.findIndex((e) => e.id === compaction.firstKeptEntryId);
	const loads = entries.flatMap((e, i) => (i < index && isSkillLoad(e, skill) ? [i] : []));
	return {
		before: entries.slice(0, index),
		after: entries.slice(index + 1),
		compaction,
		skillLoadsKept: loads.filter((i) => i >= kept).length,
		skillLoadsCompactedAway: loads.filter((i) => i < kept).length,
	};
}

export async function ask(page: Page, text: string): Promise<void> {
	await page.getByTestId("chat-input").fill(text);
	await page.getByTestId("chat-send").click();
	await expect(page.getByTestId("chat-scroll")).toHaveAttribute("data-streaming", "true", {
		timeout: 60_000,
	});
	await waitForAgentSettled(page, 240_000);
}

export async function compact(page: Page, worktreePath: string): Promise<void> {
	const compactions = () => readSession(worktreePath).filter((e) => e.type === "compaction").length;
	const failed = page.locator('[data-testid="compaction-notice"][data-status="failed"]');
	const [before, failedBefore] = [compactions(), await failed.count()];
	await page.getByTestId("chat-input").fill("/compact");
	await page.getByTestId("chat-send").click();
	await expect
		.poll(async () => compactions() > before || (await failed.count()) > failedBefore, {
			timeout: 180_000,
		})
		.toBe(true);
	if (compactions() === before)
		throw new Error(`Compaction failed: ${await failed.last().innerText()}`);
	await expect(page.getByTestId("chat-scroll")).toHaveAttribute("data-streaming", "false");
}

// Pi keeps the newest ~20K tokens verbatim; a reference message this large pushes every earlier skill
// load past the next compaction cut without overriding compaction settings or relying on tool use.
export async function pushPastCompactionTail(page: Page): Promise<void> {
	const tag = crypto.randomUUID().slice(0, 8);
	const lines = Array.from(
		{ length: 2_000 },
		(_, i) => `${tag}-${i} alpha bravo charlie delta echo foxtrot golf hotel`,
	);
	await ask(
		page,
		`Reply with only the word OK. Reference log, no action needed:\n${lines.join("\n")}`,
	);
}
