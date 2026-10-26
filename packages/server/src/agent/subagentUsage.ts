import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import {
	type FileEntry,
	migrateSessionEntries,
	parseSessionEntries,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { DelegationRunDetails } from "pi-delegation";
import { logger } from "../log";

const log = logger("agent");

export const SUBAGENT_USAGE_KIND = "subagent";

export interface SubagentUsage {
	childSessionId: string;
	provider: string;
	model: string;
	usage: Usage;
}

interface Totals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

function toUsage({ input, output, cacheRead, cacheWrite, cost }: Totals): Usage {
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
	};
}

function tokensOf(totals: Totals): number {
	return totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
}

export function runUsage(
	childSessionId: string,
	details: DelegationRunDetails,
): SubagentUsage | undefined {
	if (tokensOf(details.usage) === 0 && details.usage.cost === 0) return undefined;
	const ref = details.model ?? "unknown";
	const slash = ref.indexOf("/");
	return {
		childSessionId,
		provider: slash > 0 ? ref.slice(0, slash) : "unknown",
		model: ref.slice(slash + 1),
		usage: toUsage(details.usage),
	};
}

function spentUsage(entry: SessionEntry): Usage | undefined {
	if (entry.type === "usage") return entry.usage;
	if (entry.type === "compaction" || entry.type === "branch_summary") return entry.usage;
	if (entry.type !== "message") return undefined;
	const { message } = entry;
	if (message.role === "assistant" || message.role === "toolResult") return message.usage;
	return undefined;
}

function add(totals: Totals, usage: Usage): void {
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cacheRead += usage.cacheRead;
	totals.cacheWrite += usage.cacheWrite;
	totals.cost += usage.cost.total;
}

function emptyTotals(): Totals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

export function childFileUsage(childSessionId: string, content: string): SubagentUsage | undefined {
	const entries: FileEntry[] = parseSessionEntries(content);
	const header = entries[0];
	if (header?.type !== "session" || header.parentSession !== undefined) return undefined;
	migrateSessionEntries(entries);
	const totals = emptyTotals();
	let provider = "unknown";
	let model = "unknown";
	for (const entry of entries) {
		if (entry.type === "session") continue;
		const usage = spentUsage(entry);
		if (usage) add(totals, usage);
		if (entry.type === "message" && entry.message.role === "assistant") {
			provider = entry.message.provider;
			model = entry.message.responseModel ?? entry.message.model;
		}
	}
	return tokensOf(totals) === 0 && totals.cost === 0
		? undefined
		: { childSessionId, provider, model, usage: toUsage(totals) };
}

interface Recorded {
	totals: Totals;
	at: number;
}

export function recordedSubagentUsage(entries: readonly SessionEntry[]): Map<string, Recorded> {
	const recorded = new Map<string, Recorded>();
	for (const entry of entries) {
		if (entry.type !== "usage" || entry.kind !== SUBAGENT_USAGE_KIND || !entry.note) continue;
		const current = recorded.get(entry.note) ?? { totals: emptyTotals(), at: 0 };
		add(current.totals, entry.usage);
		current.at = Math.max(current.at, Date.parse(entry.timestamp));
		recorded.set(entry.note, current);
	}
	return recorded;
}

export function unrecordedUsage(
	total: SubagentUsage,
	recorded: Totals | undefined,
): SubagentUsage | undefined {
	const base = recorded ?? emptyTotals();
	const missing: Totals = {
		input: total.usage.input - base.input,
		output: total.usage.output - base.output,
		cacheRead: total.usage.cacheRead - base.cacheRead,
		cacheWrite: total.usage.cacheWrite - base.cacheWrite,
		cost: Math.max(0, total.usage.cost.total - base.cost),
	};
	const tokens = [missing.input, missing.output, missing.cacheRead, missing.cacheWrite];
	if (tokens.some((count) => count < 0) || tokensOf(missing) === 0) return undefined;
	return { ...total, usage: toUsage(missing) };
}

interface ChildFile {
	childSessionId: string;
	path: string;
	mtimeMs: number;
	size: number;
	total: SubagentUsage | undefined;
}

const settledChildFiles = new Map<string, { mtimeMs: number; size: number }>();

async function readChildFiles(
	dir: string,
	recorded: ReadonlyMap<string, Recorded>,
	isLive: (childSessionId: string) => boolean,
): Promise<ChildFile[]> {
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return [];
	}
	const files: ChildFile[] = [];
	for (const name of names) {
		const separator = name.indexOf("_");
		if (separator < 0 || !name.endsWith(".jsonl")) continue;
		const childSessionId = name.slice(separator + 1, -".jsonl".length);
		if (isLive(childSessionId)) continue;
		const path = join(dir, name);
		try {
			const { mtimeMs, size } = await stat(path);
			const at = recorded.get(childSessionId)?.at;
			if (at !== undefined && mtimeMs <= at) continue;
			const settled = settledChildFiles.get(path);
			if (settled?.mtimeMs === mtimeMs && settled.size === size) continue;
			files.push({
				childSessionId,
				path,
				mtimeMs,
				size,
				total: childFileUsage(childSessionId, await readFile(path, "utf8")),
			});
		} catch (error) {
			log.warn(`subagent usage was not read from ${name}`, error as Error);
		}
	}
	return files;
}

export async function reconcileSubagentUsage(deps: {
	dir: string;
	entries: () => readonly SessionEntry[] | undefined;
	isLive: (childSessionId: string) => boolean;
	record: (usage: SubagentUsage) => void;
}): Promise<void> {
	const before = deps.entries();
	if (!before) return;
	const files = await readChildFiles(deps.dir, recordedSubagentUsage(before), deps.isLive);
	const current = deps.entries();
	if (!current || files.length === 0) return;
	const recorded = recordedSubagentUsage(current);
	for (const { childSessionId, path, mtimeMs, size, total } of files) {
		if (deps.isLive(childSessionId)) continue;
		const missing = total && unrecordedUsage(total, recorded.get(childSessionId)?.totals);
		if (missing) deps.record(missing);
		else settledChildFiles.set(path, { mtimeMs, size });
	}
}
