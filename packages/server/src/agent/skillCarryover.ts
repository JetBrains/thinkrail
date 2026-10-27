import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Api, Model } from "@earendil-works/pi-ai";
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
const PI_VIRTUAL_MODEL_API = "pi-virtual";
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const SEPARATOR = "\n\n";

export const SKILL_CARRYOVER_PREAMBLE =
	"Context compaction summarized the earlier conversation, including the text of skills loaded in it. Those skills are restored below, most recently loaded last. Keep applying the ones that bear on the current work; if one you are following is marked truncated, read its file before relying on the missing part.";

export interface CarryoverBudget {
	skillChars: number;
	totalChars: number;
}

export function carryoverBudget(model: Model<Api> | undefined): CarryoverBudget | undefined {
	if (!model || model.api === PI_VIRTUAL_MODEL_API || !(model.contextWindow > 0)) return undefined;
	const totalTokens = Math.min(
		SKILL_CARRYOVER_TOTAL_TOKENS,
		Math.floor(model.contextWindow * SKILL_CARRYOVER_WINDOW_SHARE),
	);
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

function readTarget(path: string, cwd: string): string | undefined {
	const spaced = path.replace(UNICODE_SPACES, " ");
	const bare = spaced.startsWith("@") ? spaced.slice(1) : spaced;
	const expanded = bare === "~" || bare.startsWith("~/") ? join(homedir(), bare.slice(1)) : bare;
	try {
		const local = expanded.startsWith("file://") ? fileURLToPath(expanded) : expanded;
		return canonicalPath(resolve(cwd, local));
	} catch {
		return undefined;
	}
}

interface LineRange {
	start: number;
	end: number;
}

interface ReadLoad {
	skill: Skill;
	start: number;
	limit: number | undefined;
}

interface SkillLoad {
	skill: Skill;
	index: number;
	lines: LineRange;
}

const WHOLE_FILE: LineRange = { start: 0, end: Number.POSITIVE_INFINITY };

function readLines(read: ReadLoad, details: unknown): LineRange {
	const truncation = (details as { truncation?: { truncated?: unknown; outputLines?: unknown } })
		?.truncation;
	if (truncation?.truncated === true) {
		const shown = typeof truncation.outputLines === "number" ? truncation.outputLines : 0;
		return { start: read.start, end: read.start + shown };
	}
	const end = read.limit === undefined ? Number.POSITIVE_INFINITY : read.start + read.limit;
	return { start: read.start, end };
}

function covers(ranges: readonly LineRange[], lineCount: number): boolean {
	let reach = 0;
	for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
		if (range.start > reach) break;
		reach = Math.max(reach, range.end);
	}
	return reach >= lineCount;
}

function skillLoads(
	entries: readonly SessionEntry[],
	skills: readonly Skill[],
	cwd: string,
): SkillLoad[] {
	const byName = new Map(skills.map((skill) => [skill.name, skill]));
	const byPath = new Map(skills.map((skill) => [canonicalPath(resolve(skill.filePath)), skill]));
	const reads = new Map<string, ReadLoad>();
	const loads: SkillLoad[] = [];
	entries.forEach((entry, index) => {
		if (entry.type !== "message") return;
		const message = entry.message;
		if (message.role === "user") {
			for (const text of texts(message.content)) {
				const block = parseSkillBlock(text);
				const skill = block && byName.get(block.name);
				if (skill) loads.push({ skill, index, lines: WHOLE_FILE });
			}
		} else if (message.role === "assistant") {
			for (const part of message.content) {
				if (part.type !== "toolCall" || part.name !== "read") continue;
				const args = part.arguments as { path?: unknown; offset?: unknown; limit?: unknown };
				if (typeof args.path !== "string") continue;
				const target = readTarget(args.path, cwd);
				const skill = target && byPath.get(target);
				if (skill)
					reads.set(part.id, {
						skill,
						start: typeof args.offset === "number" ? Math.max(0, args.offset - 1) : 0,
						limit: typeof args.limit === "number" ? args.limit : undefined,
					});
			}
		} else if (message.role === "toolResult" && !message.isError) {
			const read = reads.get(message.toolCallId);
			if (read) loads.push({ skill: read.skill, index, lines: readLines(read, message.details) });
		}
	});
	return loads;
}

function skillLineCount(skill: Skill): number | undefined {
	try {
		return readFileSync(skill.filePath, "utf8").split("\n").length;
	} catch {
		return undefined;
	}
}

export function compactedSkills(
	entries: readonly SessionEntry[],
	skills: readonly Skill[],
	cwd: string,
	lineCount: (skill: Skill) => number | undefined = skillLineCount,
): Skill[] {
	const compaction = entries.findLastIndex((entry) => entry.type === "compaction");
	const entry = entries[compaction];
	if (entry?.type !== "compaction") return [];
	const kept = entries.findIndex((candidate) => candidate.id === entry.firstKeptEntryId);
	const cut = kept < 0 || kept > compaction ? compaction : kept;
	const loads = skillLoads(entries, skills, cwd);
	const latest = new Map<Skill, number>();
	for (const load of loads) latest.set(load.skill, load.index);
	const retained = (skill: Skill) =>
		covers(
			loads.filter((load) => load.skill === skill && load.index >= cut).map((load) => load.lines),
			lineCount(skill) ?? Number.POSITIVE_INFINITY,
		);
	return [...latest]
		.filter(([skill]) => loads.some((load) => load.skill === skill && load.index < cut))
		.filter(([skill]) => !retained(skill))
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
	let used = SKILL_CARRYOVER_PREAMBLE.length;
	for (const skill of [...skills].reverse()) {
		const open = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n`;
		const close = "\n</skill>";
		const room = budget.totalChars - used - SEPARATOR.length - open.length - close.length;
		if (room <= 0) continue;
		const body = readBody(skill);
		if (body === undefined) continue;
		const notice = `\n\n[Truncated after compaction. Read ${skill.filePath} for the full text.]`;
		const keep = Math.min(budget.skillChars, room - notice.length);
		const text =
			body.length <= Math.min(budget.skillChars, room)
				? body
				: keep > 0
					? `${body.slice(0, keep)}${notice}`
					: undefined;
		if (text === undefined) continue;
		const block = `${open}${text}${close}`;
		used += SEPARATOR.length + block.length;
		blocks.unshift(block);
	}
	return blocks.length > 0 ? [SKILL_CARRYOVER_PREAMBLE, ...blocks].join(SEPARATOR) : undefined;
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
		const budget = carryoverBudget(ctx.model);
		if (!budget) return;
		const key = `${compaction.id}:${budget.totalChars}:${skills.map((skill) => skill.filePath).join("|")}`;
		if (memo?.key !== key)
			memo = { key, text: skillCarryoverText(compactedSkills(entries, skills, ctx.cwd), budget) };
		const messages = withSkillCarryover(event.messages, memo.text);
		return messages ? { messages } : undefined;
	});
}
