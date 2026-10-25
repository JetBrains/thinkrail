import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
	type ExtensionAPI,
	parseSkillBlock,
	type SessionEntry,
	type Skill,
	stripFrontmatter,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@thinkrail/contracts";

export const SKILL_CARRYOVER_CUSTOM_TYPE = "thinkrail/skill-carryover";
const SKILL_CARRYOVER_SKILL_TOKENS = 5_000;
const SKILL_CARRYOVER_TOTAL_TOKENS = 25_000;
const SKILL_CARRYOVER_WINDOW_SHARE = 0.1;

const CHARS_PER_TOKEN = 4;

export const SKILL_CARRYOVER_PREAMBLE =
	"Context compaction summarized the earlier conversation, including the text of skills loaded in it. Those skills are restored below, most recently loaded last. Keep applying the ones that bear on the current work; if one you are following is marked truncated, read its file before relying on the missing part.";

export interface CarryoverBudget {
	skillChars: number;
	totalChars: number;
}

export function carryoverBudget(contextWindow: number | undefined): CarryoverBudget {
	const windowTokens =
		contextWindow && contextWindow > 0
			? Math.floor(contextWindow * SKILL_CARRYOVER_WINDOW_SHARE)
			: SKILL_CARRYOVER_TOTAL_TOKENS;
	const totalTokens = Math.min(SKILL_CARRYOVER_TOTAL_TOKENS, windowTokens);
	return {
		skillChars: Math.min(SKILL_CARRYOVER_SKILL_TOKENS, totalTokens) * CHARS_PER_TOKEN,
		totalChars: totalTokens * CHARS_PER_TOKEN,
	};
}

function texts(content: unknown): string[] {
	if (typeof content === "string") return [content];
	if (!Array.isArray(content)) return [];
	return content.flatMap((part) =>
		part?.type === "text" && typeof part.text === "string" ? [part.text] : [],
	);
}

function canonicalPath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

function readTarget(path: string, cwd: string): string {
	const bare = path.startsWith("@") ? path.slice(1) : path;
	const expanded = bare === "~" || bare.startsWith("~/") ? join(homedir(), bare.slice(1)) : bare;
	return canonicalPath(resolve(cwd, expanded));
}

function skillLoads(
	entries: readonly SessionEntry[],
	skills: readonly Skill[],
	cwd: string,
): Map<Skill, number> {
	const byName = new Map(skills.map((skill) => [skill.name, skill]));
	const byPath = new Map(skills.map((skill) => [canonicalPath(resolve(skill.filePath)), skill]));
	const reads = new Map<string, Skill>();
	const latest = new Map<Skill, number>();
	entries.forEach((entry, index) => {
		if (entry.type !== "message") return;
		const message = entry.message;
		if (message.role === "user") {
			for (const text of texts(message.content)) {
				const block = parseSkillBlock(text);
				const skill = block && byName.get(block.name);
				if (skill) latest.set(skill, index);
			}
		} else if (message.role === "assistant") {
			for (const part of message.content) {
				if (part.type !== "toolCall" || part.name !== "read") continue;
				const path = (part.arguments as { path?: unknown }).path;
				if (typeof path !== "string") continue;
				const skill = byPath.get(readTarget(path, cwd));
				if (skill) reads.set(part.id, skill);
			}
		} else if (message.role === "toolResult" && !message.isError) {
			const skill = reads.get(message.toolCallId);
			if (skill) latest.set(skill, index);
		}
	});
	return latest;
}

export function compactedSkills(
	entries: readonly SessionEntry[],
	skills: readonly Skill[],
	cwd: string,
): Skill[] {
	const compaction = entries.findLastIndex((entry) => entry.type === "compaction");
	const entry = entries[compaction];
	if (entry?.type !== "compaction") return [];
	const kept = entries.findIndex((candidate) => candidate.id === entry.firstKeptEntryId);
	const cut = kept < 0 || kept > compaction ? compaction : kept;
	return [...skillLoads(entries, skills, cwd)]
		.filter(([, index]) => index < cut)
		.sort(([, a], [, b]) => a - b)
		.map(([skill]) => skill);
}

function skillBody(skill: Skill): string | undefined {
	try {
		return stripFrontmatter(readFileSync(skill.filePath, "utf8")).trim();
	} catch {
		return undefined;
	}
}

export function skillCarryoverText(
	skills: readonly Skill[],
	budget: CarryoverBudget,
	readBody: (skill: Skill) => string | undefined = skillBody,
): string | undefined {
	const blocks: string[] = [];
	let used = 0;
	for (const skill of [...skills].reverse()) {
		const room = Math.min(budget.skillChars, budget.totalChars - used);
		if (room <= 0) break;
		const body = readBody(skill);
		if (body === undefined) continue;
		const text =
			body.length <= room
				? body
				: `${body.slice(0, room)}\n\n[Truncated after compaction. Read ${skill.filePath} for the full text.]`;
		used += Math.min(body.length, room);
		blocks.unshift(
			`<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${text}\n</skill>`,
		);
	}
	return blocks.length > 0 ? [SKILL_CARRYOVER_PREAMBLE, ...blocks].join("\n\n") : undefined;
}

export function withSkillCarryover(
	messages: AgentMessage[],
	text: string | undefined,
): AgentMessage[] | undefined {
	const summary = messages.findIndex((message) => message.role === "compactionSummary");
	if (text === undefined || summary < 0) return undefined;
	const carryover: AgentMessage = {
		role: "custom",
		customType: SKILL_CARRYOVER_CUSTOM_TYPE,
		content: text,
		display: false,
		timestamp: messages[summary]?.timestamp ?? Date.now(),
	};
	return [...messages.slice(0, summary + 1), carryover, ...messages.slice(summary + 1)];
}

export function skillCarryover(pi: ExtensionAPI): void {
	let skills: readonly Skill[] = [];
	let memo: { key: string; text: string | undefined } | undefined;
	pi.on("before_agent_start", (event) => {
		skills = event.systemPromptOptions.skills;
	});
	pi.on("context", (event, ctx) => {
		const entries = ctx.sessionManager.getBranch();
		const compaction = entries.findLast((entry) => entry.type === "compaction");
		if (!compaction) return;
		const budget = carryoverBudget(ctx.model?.contextWindow);
		const key = `${compaction.id}:${budget.totalChars}:${skills.map((skill) => skill.filePath).join("|")}`;
		if (memo?.key !== key)
			memo = { key, text: skillCarryoverText(compactedSkills(entries, skills, ctx.cwd), budget) };
		const messages = withSkillCarryover(event.messages, memo.text);
		return messages ? { messages } : undefined;
	});
}
