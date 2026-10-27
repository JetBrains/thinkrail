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

const COST_EPSILON = 1e-9;

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

function recordedSubagentUsage(entries: readonly SessionEntry[]): Map<string, Totals> {
	const recorded = new Map<string, Totals>();
	for (const entry of entries) {
		if (entry.type !== "usage" || entry.kind !== SUBAGENT_USAGE_KIND || !entry.note) continue;
		const totals = recorded.get(entry.note) ?? emptyTotals();
		add(totals, entry.usage);
		recorded.set(entry.note, totals);
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
		cost: total.usage.cost.total - base.cost,
	};
	const tokens = [missing.input, missing.output, missing.cacheRead, missing.cacheWrite];
	if (tokens.some((count) => count < 0)) return undefined;
	if (missing.cost <= COST_EPSILON) missing.cost = 0;
	if (tokensOf(missing) === 0 && missing.cost === 0) return undefined;
	return { ...total, usage: toUsage(missing) };
}

const childTotals = new Map<
	string,
	{ mtimeMs: number; size: number; total: SubagentUsage | undefined }
>();

async function readChildTotals(
	dir: string,
	isLive: (childSessionId: string) => boolean,
): Promise<SubagentUsage[]> {
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return [];
	}
	const totals: SubagentUsage[] = [];
	for (const name of names) {
		const separator = name.indexOf("_");
		if (separator < 0 || !name.endsWith(".jsonl")) continue;
		const childSessionId = name.slice(separator + 1, -".jsonl".length);
		if (isLive(childSessionId)) continue;
		const path = join(dir, name);
		try {
			const { mtimeMs, size } = await stat(path);
			let cached = childTotals.get(path);
			if (cached?.mtimeMs !== mtimeMs || cached.size !== size) {
				const total = childFileUsage(childSessionId, await readFile(path, "utf8"));
				cached = { mtimeMs, size, total };
				childTotals.set(path, cached);
			}
			if (cached.total) totals.push(cached.total);
		} catch (error) {
			log.warn(`subagent usage was not read from ${name}`, error as Error);
		}
	}
	return totals;
}

export async function reconcileSubagentUsage(deps: {
	dir: string;
	entries: () => readonly SessionEntry[] | undefined;
	isLive: (childSessionId: string) => boolean;
	record: (usage: SubagentUsage) => void;
}): Promise<void> {
	if (!deps.entries()) return;
	const totals = await readChildTotals(deps.dir, deps.isLive);
	const current = deps.entries();
	if (!current || totals.length === 0) return;
	const recorded = recordedSubagentUsage(current);
	for (const total of totals) {
		if (deps.isLive(total.childSessionId)) continue;
		const missing = unrecordedUsage(total, recorded.get(total.childSessionId));
		if (missing) deps.record(missing);
	}
}
