import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeTools } from "./agent";
import { emptyUsage, isRecord, type Usage } from "./model";
import type { AgentOptions } from "./types";

export const safeStringify = (value: unknown, space: number = 2): string => {
	const seen = new WeakSet<object>();
	return (
		JSON.stringify(
			value,
			(_key, v: unknown) => {
				if (typeof v === "bigint") return `${v}`;
				if (v instanceof Map) return Object.fromEntries(v);
				if (v instanceof Set) return [...v];
				if (typeof v === "object" && v !== null) {
					if (seen.has(v)) return "[circular]";
					seen.add(v);
				}
				return v;
			},
			space,
		) ?? "null"
	);
};

const canonicalJson = (value: unknown): string => {
	const seen = new WeakSet<object>();
	const walk = (v: unknown): string => {
		if (v === undefined) return "null";
		if (v === null || typeof v === "number" || typeof v === "boolean")
			return JSON.stringify(v) ?? "null";
		if (typeof v === "string") return JSON.stringify(v);
		if (typeof v === "bigint") return JSON.stringify(`${v}`);
		if (typeof v !== "object") return JSON.stringify(String(v));
		if (seen.has(v)) return '"[circular]"';
		seen.add(v);
		if (Array.isArray(v)) return `[${v.map(walk).join(",")}]`;
		const entries = Object.entries(v as Record<string, unknown>)
			.filter(([, member]) => member !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([k, member]) => `${JSON.stringify(k)}:${walk(member)}`).join(",")}}`;
	};
	return walk(value);
};

export const agentKey = (prompt: string, options: AgentOptions = {}): string =>
	crypto
		.createHash("sha256")
		.update(
			canonicalJson({
				prompt,
				schema: options.schema,
				model: options.model,
				agentType: options.agentType,
				tools: normalizeTools(options.tools),
				system: options.system,
				effort: options.effort,
				maxTurns: options.maxTurns,
			}),
		)
		.digest("hex");

export interface JournalStarted {
	key: string;
	agentIndex: number;
	label: string;
}

export interface JournalResult {
	key: string;
	agentIndex: number;
	label: string;
	ok: boolean;
	value?: unknown;
	error?: string;
	attempts?: number;
	usage?: Usage;
	durationMs?: number;
}

export interface JournalWriter {
	appendStarted: (entry: JournalStarted) => void;
	appendResult: (entry: JournalResult) => void;
}

export const openJournal = (file: string, onError?: (message: string) => void): JournalWriter => {
	let reported = false;
	let dirReady = false;

	const write = (line: object): void => {
		try {
			if (!dirReady) {
				fs.mkdirSync(path.dirname(file), { recursive: true });
				dirReady = true;
			}
			fs.appendFileSync(file, `${safeStringify(line, 0)}\n`, "utf8");
		} catch (error) {
			if (reported) return;
			reported = true;
			onError?.((error as Error).message);
		}
	};

	return {
		appendStarted: (entry) => write({ type: "started", ...entry, ts: Date.now() }),
		appendResult: (entry) => {
			const ts = Date.now();
			try {
				safeStringify(entry.value, 0);
			} catch (error) {
				write({
					type: "result",
					key: entry.key,
					agentIndex: entry.agentIndex,
					label: entry.label,
					ok: false,
					value: null,
					error: `result could not be serialized: ${(error as Error).message}`,
					ts,
				});
				return;
			}
			write({ type: "result", ...entry, ts });
		},
	};
};

export interface ReplayEntry {
	key: string;
	ok: boolean;
	value: unknown;
	error?: string;
	attempts: number;
	usage: Usage;
	durationMs?: number;
	label?: string;
}

export interface ReplayStats {
	loaded: number;
	served: number;
	skipped: number;
	closed: boolean;
}

export interface ReplayStore {
	take: (key: string) => ReplayEntry | undefined;
	stats: () => ReplayStats;
}

const usageOf = (value: unknown): Usage => {
	const usage = emptyUsage();
	if (!isRecord(value)) return usage;
	for (const key of Object.keys(usage) as Array<keyof Usage>) {
		const field = value[key];
		if (typeof field === "number") usage[key] = field;
	}
	return usage;
};

const toEntry = (raw: Record<string, unknown>): ReplayEntry | undefined => {
	if (raw.type !== "result" || typeof raw.key !== "string") return undefined;
	return {
		key: raw.key,
		ok: raw.ok === true,
		value: raw.value ?? null,
		attempts: typeof raw.attempts === "number" ? raw.attempts : 1,
		usage: usageOf(raw.usage),
		...(typeof raw.error === "string" ? { error: raw.error } : {}),
		...(typeof raw.durationMs === "number" ? { durationMs: raw.durationMs } : {}),
		...(typeof raw.label === "string" ? { label: raw.label } : {}),
	};
};

export const loadJournal = (file: string, opts?: { retryFailed?: boolean }): ReplayStore => {
	const text = fs.readFileSync(file, "utf8");
	const queues = new Map<string, Array<ReplayEntry | null>>();
	let loaded = 0;
	let skipped = 0;
	let served = 0;
	let closed = false;

	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		let raw: unknown;
		try {
			raw = JSON.parse(line);
		} catch {
			skipped++;
			continue;
		}
		if (typeof raw !== "object" || raw === null) {
			skipped++;
			continue;
		}
		const entry = toEntry(raw as Record<string, unknown>);
		if (!entry) {
			if ((raw as Record<string, unknown>).type !== "started") skipped++;
			continue;
		}
		const slot = !entry.ok && opts?.retryFailed ? null : entry;
		const queue = queues.get(entry.key);
		if (queue) queue.push(slot);
		else queues.set(entry.key, [slot]);
		if (slot) loaded++;
	}

	return {
		take: (key) => {
			if (closed) return undefined;
			const queue = queues.get(key);
			if (!queue || queue.length === 0) {
				closed = true;
				return undefined;
			}
			const hit = queue.shift();
			if (!hit) return undefined;
			served++;
			return hit;
		},
		stats: () => ({ loaded, served, skipped, closed }),
	};
};
