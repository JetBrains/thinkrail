import { callArguments, wordDiff } from "./analysis.ts";
import {
	FINDING_RULES,
	type Figure,
	type Finding,
	type FindingDiff,
	type FindingFigure,
	type FindingGroup,
	type FindingLink,
	type FindingRule,
	type FindingSeverity,
	type FindingsHideParams,
	type FindingsListResult,
	type IndexState,
	KNOWN_EXIT_CODES,
	METRIC_SOURCES,
	REWORK_CHANGES,
	SESSION_INSIGHTS_API_VERSION,
} from "./core.ts";
import { type ScopedSession, type StatsInput, statsScope } from "./crossSession.ts";
import type { CallRef } from "./digest.ts";
import { mainArgument } from "./facts.ts";
import { parseLine, readRange } from "./lines.ts";
import { createRedactor, type Redactor } from "./redact.ts";
import { clusterSentences, type SentenceItem } from "./repeats.ts";
import { byText, outliers, wilson } from "./stats.ts";
import type { JsonStore } from "./store.ts";
import { isRecord } from "./totals.ts";

const R = FINDING_RULES;
const LINKS = 6;
const ARGUMENT_CHARS = 600;
const ID_MAX = 400;
export const HIDDEN_FINDINGS = "findings.json";
const HEAD = /^[A-Za-z][\w.+-]*( [\w:.+-]+)*$/;

const GROUP_ORDER: readonly FindingGroup[] = ["skills", "commands", "context", "files"];
const RULE_ORDER: readonly FindingRule[] = [
	"skillNeverLoaded",
	"skillUnlisted",
	"commandFailing",
	"falseError",
	"loop",
	"poorRecovery",
	"oversizedOutput",
	"contextLimit",
	"cacheMisses",
	"costOutlier",
	"tokenOutlier",
	"subagentsOutside",
	"rework",
	"repeatedInstruction",
	"unverifiedClaim",
];

const RULE_GROUP: Readonly<Record<FindingRule, FindingGroup>> = {
	skillNeverLoaded: "skills",
	skillUnlisted: "skills",
	commandFailing: "commands",
	falseError: "commands",
	loop: "commands",
	poorRecovery: "commands",
	oversizedOutput: "commands",
	contextLimit: "context",
	cacheMisses: "context",
	costOutlier: "context",
	tokenOutlier: "context",
	subagentsOutside: "context",
	rework: "files",
	repeatedInstruction: "files",
	unverifiedClaim: "files",
};

const RULE_SEVERITY: Readonly<Record<FindingRule, FindingSeverity>> = {
	skillNeverLoaded: "warning",
	skillUnlisted: "info",
	commandFailing: "error",
	falseError: "info",
	loop: "warning",
	poorRecovery: "warning",
	oversizedOutput: "warning",
	contextLimit: "error",
	cacheMisses: "info",
	costOutlier: "warning",
	tokenOutlier: "warning",
	subagentsOutside: "info",
	rework: "warning",
	repeatedInstruction: "info",
	unverifiedClaim: "info",
};

const HEURISTIC: ReadonlySet<FindingRule> = new Set<FindingRule>([
	"poorRecovery",
	"cacheMisses",
	"repeatedInstruction",
	"unverifiedClaim",
]);

export function parseFindingsHideParams(value: unknown): FindingsHideParams {
	if (isRecord(value)) {
		const { id, hidden } = value;
		if (
			typeof id === "string" &&
			id.length > 0 &&
			id.length <= ID_MAX &&
			typeof hidden === "boolean"
		)
			return { id, hidden };
	}
	throw new Error("Invalid findings.hide params");
}

/** The hidden-findings document: the ids the user hid, sorted. */
export function parseHidden(value: unknown): { hidden: string[] } {
	const list = isRecord(value) && Array.isArray(value.hidden) ? value.hidden : [];
	return {
		hidden: [
			...new Set(list.filter((id): id is string => typeof id === "string" && id.length <= ID_MAX)),
		].sort(),
	};
}

/** Hides or shows a finding again, in the embedder's store. */
export async function setFindingHidden(
	store: JsonStore,
	params: FindingsHideParams,
): Promise<string[]> {
	const written = await store.update(HIDDEN_FINDINGS, parseHidden, ({ hidden }) => ({
		hidden: params.hidden
			? [...new Set([...hidden, params.id])].sort()
			: hidden.filter((id) => id !== params.id),
	}));
	return written.hidden;
}

type Draft = Omit<Finding, "group" | "severity" | "heuristic" | "hidden">;

function blank(id: string, rule: FindingRule): Draft {
	return {
		id,
		rule,
		subject: null,
		count: 0,
		total: null,
		rate: null,
		figures: {},
		ratio: null,
		names: [],
		shares: [],
		quote: null,
		worked: null,
		links: [],
		sessions: [],
		last: null,
	};
}

function linksOf(entries: Map<number, { count: number; events: string[] }>): {
	links: FindingLink[];
	sessions: number[];
} {
	const links = [...entries]
		.map(([session, entry]) => ({ session, count: entry.count, events: entry.events.slice(0, 3) }))
		.sort((a, b) => b.count - a.count || a.session - b.session);
	return {
		links: links.slice(0, LINKS),
		sessions: links.map((link) => link.session).sort((a, b) => a - b),
	};
}

function note(
	entries: Map<number, { count: number; events: string[] }>,
	session: number,
	count: number,
	events: readonly string[],
): void {
	let entry = entries.get(session);
	if (!entry) {
		entry = { count: 0, events: [] };
		entries.set(session, entry);
	}
	entry.count += count;
	for (const event of events) if (entry.events.length < 3 && event) entry.events.push(event);
}

function lastOf(sessions: readonly ScopedSession[], indices: readonly number[]): number | null {
	let last: number | null = null;
	const wanted = new Set(indices);
	for (const session of sessions)
		if (wanted.has(session.index) && session.summary.end !== null)
			last = Math.max(last ?? session.summary.end, session.summary.end);
	return last;
}

function skillFindings(sessions: readonly ScopedSession[]): Draft[] {
	const listing = sessions.filter(({ digest }) => digest.listed !== null);
	if (listing.length === 0) return [];
	const listed = new Map<string, { sessions: number; chars: number }>();
	for (const { digest } of listing)
		for (const [name, chars] of digest.listed ?? []) {
			const entry = listed.get(name) ?? { sessions: 0, chars: 0 };
			entry.sessions += 1;
			entry.chars = Math.max(entry.chars, chars);
			listed.set(name, entry);
		}
	const loaded = new Set<string>();
	for (const { digest } of sessions) for (const name of digest.loads.keys()) loaded.add(name);
	const out: Draft[] = [];
	const never = [...listed].filter(([name]) => !loaded.has(name)).sort(([a], [b]) => byText(a, b));
	if (never.length > 0) {
		const draft = blank("skills:never", "skillNeverLoaded");
		const indices = listing.map(({ index }) => index).sort((a, b) => a - b);
		draft.count = never.length;
		draft.total = listing.length;
		draft.names = never.map(([name]) => name);
		draft.shares = never.map(([name, entry]) => ({ key: name, count: entry.sessions }));
		draft.figures = {
			perRequest: {
				value: Math.ceil(never.reduce((sum, [, entry]) => sum + entry.chars, 0) / 4),
				origin: "approximated",
			},
		};
		draft.sessions = indices;
		draft.last = lastOf(sessions, indices);
		out.push(draft);
	}
	const unlisted = new Map<string, number>();
	const entries = new Map<number, { count: number; events: string[] }>();
	for (const { index, digest } of listing)
		for (const [name, loads] of digest.loads) {
			if (digest.listed?.has(name)) continue;
			unlisted.set(name, (unlisted.get(name) ?? 0) + loads.loads);
			note(entries, index, loads.loads, loads.events);
		}
	if (unlisted.size > 0) {
		const draft = blank("skills:unlisted", "skillUnlisted");
		const shares = [...unlisted]
			.map(([key, count]) => ({ key, count }))
			.sort((a, b) => b.count - a.count || byText(a.key, b.key));
		draft.count = shares.reduce((sum, share) => sum + share.count, 0);
		draft.names = shares.map((share) => share.key);
		draft.shares = shares;
		Object.assign(draft, linksOf(entries));
		draft.last = lastOf(sessions, draft.sessions);
		out.push(draft);
	}
	return out;
}

interface WorkedCandidate {
	session: number;
	file: string;
	ref: { failed: CallRef; next: CallRef };
}

/** Sessions whose "what worked" pair is read to find one that changed the arguments. */
const WORKED_CANDIDATES = 5;

interface CommandDraft {
	head: string;
	calls: number;
	fails: number;
	exits: Map<string, number>;
	failures: { key: string; line: string; t: number }[];
	entries: Map<number, { count: number; events: string[] }>;
	worked: WorkedCandidate[];
	exitEvents: Map<string, Map<number, { count: number; events: string[] }>>;
}

function commandDrafts(sessions: readonly ScopedSession[]): Map<string, CommandDraft> {
	const out = new Map<string, CommandDraft>();
	for (const { index, digest, summary } of sessions)
		for (const [head, command] of digest.commands) {
			let draft = out.get(head);
			if (!draft) {
				draft = {
					head,
					calls: 0,
					fails: 0,
					exits: new Map(),
					failures: [],
					entries: new Map(),
					worked: [],
					exitEvents: new Map(),
				};
				out.set(head, draft);
			}
			draft.calls += command.calls;
			draft.fails += command.errors;
			for (const [exit, count] of command.exits)
				draft.exits.set(exit, (draft.exits.get(exit) ?? 0) + count);
			if (command.errors > 0)
				note(
					draft.entries,
					index,
					command.errors,
					command.failures.map((failure) => failure.eventId),
				);
			for (const failure of command.failures) {
				draft.failures.push(failure);
				if (failure.exit === null) continue;
				let byExit = draft.exitEvents.get(failure.exit);
				if (!byExit) {
					byExit = new Map();
					draft.exitEvents.set(failure.exit, byExit);
				}
				note(byExit, index, 1, [failure.eventId]);
			}
			if (command.worked && draft.worked.length < WORKED_CANDIDATES)
				draft.worked.push({ session: index, file: summary.file, ref: command.worked });
		}
	return out;
}

/** The most common normalized error line among failures, quoted by its first real (redacted) line. */
function quoteOf(failures: readonly { key: string; line: string }[]): Finding["quote"] {
	const counts = new Map<string, { count: number; line: string }>();
	for (const failure of failures) {
		const entry = counts.get(failure.key);
		if (entry) entry.count += 1;
		else counts.set(failure.key, { count: 1, line: failure.line });
	}
	const best = [...counts].sort((a, b) => b[1].count - a[1].count || byText(a[0], b[0]))[0];
	return best?.[1].line ? { text: best[1].line, count: best[1].count } : null;
}

async function readArgument(
	file: string,
	ref: CallRef,
	redactor: Redactor,
): Promise<string | null> {
	try {
		const entry = parseLine(await readRange(file, ref.source.range));
		if (!isRecord(entry) || (typeof entry.id === "string" && entry.id !== ref.source.entryId))
			return null;
		const args = callArguments(entry, ref.source.callIndex);
		if (args === undefined) return null;
		return redactor.cap(mainArgument(args), ARGUMENT_CHARS).text;
	} catch {
		return null;
	}
}

/** The first candidate whose successful run changed the arguments, else the first one readable. */
async function workedDiff(
	candidates: readonly WorkedCandidate[],
	redactor: Redactor,
): Promise<FindingDiff | null> {
	let fallback: FindingDiff | null = null;
	for (const worked of candidates) {
		const before = await readArgument(worked.file, worked.ref.failed, redactor);
		const after = await readArgument(worked.file, worked.ref.next, redactor);
		const segments = before === null || after === null ? null : wordDiff(before, after);
		if (!segments) continue;
		const diff: FindingDiff = {
			session: worked.session,
			failedEvent: worked.ref.failed.eventId,
			workedEvent: worked.ref.next.eventId,
			segments,
		};
		if (segments.some((segment) => segment.op !== "same")) return diff;
		fallback ??= diff;
	}
	return fallback;
}

async function commandFindings(
	sessions: readonly ScopedSession[],
	redactor: Redactor,
): Promise<Draft[]> {
	const drafts = commandDrafts(sessions);
	const failing = [...drafts.values()]
		.filter(
			(draft) =>
				HEAD.test(draft.head) &&
				draft.fails >= R.failingFailures &&
				draft.fails / draft.calls >= R.failingShare &&
				draft.entries.size >= R.failingSessions,
		)
		.sort((a, b) => b.fails - a.fails || byText(a.head, b.head))
		.filter(
			(draft, at) =>
				at < R.failingShown || (wilson(draft.fails, draft.calls)?.low ?? 0) >= R.failingStrong,
		);
	const out: Draft[] = [];
	for (const command of failing) {
		const draft = blank(`command:${command.head}`, "commandFailing");
		draft.subject = command.head;
		draft.count = command.fails;
		draft.total = command.calls;
		draft.rate = wilson(command.fails, command.calls);
		draft.shares = [...command.exits]
			.map(([key, count]) => ({ key, count }))
			.sort((a, b) => b.count - a.count || byText(a.key, b.key));
		draft.quote = quoteOf(command.failures);
		draft.worked = await workedDiff(command.worked, redactor);
		Object.assign(draft, linksOf(command.entries));
		draft.last = command.failures.reduce<number | null>(
			(last, failure) => Math.max(last ?? failure.t, failure.t),
			null,
		);
		out.push(draft);
	}
	for (const known of KNOWN_EXIT_CODES) {
		const command = drafts.get(known.head);
		const count = command?.exits.get(known.exit) ?? 0;
		if (!command || count < R.falseErrors) continue;
		const draft = blank(`falseError:${known.head}:${known.exit}`, "falseError");
		draft.subject = known.head;
		draft.count = count;
		draft.total = command.fails;
		draft.names = [known.meaning];
		draft.shares = [{ key: known.exit, count }];
		Object.assign(draft, linksOf(command.exitEvents.get(known.exit) ?? new Map()));
		draft.last = lastOf(sessions, draft.sessions);
		out.push(draft);
	}
	return out;
}

function perTool<T extends { count: number; events: string[] }>(
	sessions: readonly ScopedSession[],
	pick: (session: ScopedSession) => Map<string, T>,
): Map<
	string,
	{ count: number; entries: Map<number, { count: number; events: string[] }>; items: T[] }
> {
	const out = new Map<
		string,
		{ count: number; entries: Map<number, { count: number; events: string[] }>; items: T[] }
	>();
	for (const session of sessions)
		for (const [key, item] of pick(session)) {
			let entry = out.get(key);
			if (!entry) {
				entry = { count: 0, entries: new Map(), items: [] };
				out.set(key, entry);
			}
			entry.count += item.count;
			entry.items.push(item);
			note(entry.entries, session.index, item.count, item.events);
		}
	return out;
}

function toolFindings(sessions: readonly ScopedSession[]): Draft[] {
	const out: Draft[] = [];
	const loops = [...perTool(sessions, ({ digest }) => digest.loops)]
		.filter(([, entry]) => entry.count >= R.loops)
		.sort(([a, x], [b, y]) => y.count - x.count || byText(a, b))
		.slice(0, R.toolCards);
	for (const [key, entry] of loops) {
		const draft = blank(`loop:${key}`, "loop");
		draft.subject = key;
		draft.count = entry.count;
		draft.ratio = Math.max(...entry.items.map((item) => item.longest));
		Object.assign(draft, linksOf(entry.entries));
		draft.last = lastOf(sessions, draft.sessions);
		out.push(draft);
	}
	const recovery = new Map<
		string,
		{ chains: number; recovered: number; entries: Map<number, { count: number; events: string[] }> }
	>();
	for (const { index, digest } of sessions)
		for (const [tool, item] of digest.recovery) {
			let entry = recovery.get(tool);
			if (!entry) {
				entry = { chains: 0, recovered: 0, entries: new Map() };
				recovery.set(tool, entry);
			}
			entry.chains += item.chains;
			entry.recovered += item.recovered;
			note(entry.entries, index, item.chains - item.recovered, item.events);
		}
	const poor = [...recovery]
		.filter(
			([, entry]) =>
				entry.chains >= R.recoveryChains &&
				entry.entries.size >= R.recoverySessions &&
				entry.recovered / entry.chains < R.recoveryShare,
		)
		.sort(([a, x], [b, y]) => x.recovered / x.chains - y.recovered / y.chains || byText(a, b))
		.slice(0, R.toolCards);
	for (const [tool, entry] of poor) {
		const draft = blank(`recovery:${tool}`, "poorRecovery");
		draft.subject = tool;
		draft.count = entry.recovered;
		draft.total = entry.chains;
		draft.rate = wilson(entry.recovered, entry.chains);
		Object.assign(draft, linksOf(entry.entries));
		draft.last = lastOf(sessions, draft.sessions);
		out.push(draft);
	}
	const oversized = [...perTool(sessions, ({ digest }) => digest.oversized)]
		.filter(([, entry]) => entry.count >= R.oversizedCalls)
		.sort(([a, x], [b, y]) => y.count - x.count || byText(a, b))
		.slice(0, R.toolCards);
	for (const [key, entry] of oversized) {
		const draft = blank(`oversized:${key}`, "oversizedOutput");
		draft.subject = key;
		draft.count = entry.count;
		draft.figures = {
			largestOutput: { value: Math.max(...entry.items.map((item) => item.max)), origin: "counted" },
		};
		Object.assign(draft, linksOf(entry.entries));
		draft.last = lastOf(sessions, draft.sessions);
		out.push(draft);
	}
	return out;
}

async function contextFindings(
	sessions: readonly ScopedSession[],
	input: StatsInput,
): Promise<Draft[]> {
	const out: Draft[] = [];
	const limits = new Map<number, { count: number; events: string[] }>();
	let peak: { tokens: number; model: string; session: ScopedSession } | null = null;
	for (const session of sessions) {
		const { digest } = session;
		if (digest.contextLimits.length === 0) continue;
		note(limits, session.index, digest.contextLimits.length, digest.contextLimits);
		for (const model of digest.limitModels) {
			const tokens = digest.models.get(model)?.peak ?? 0;
			if (!peak || tokens > peak.tokens) peak = { tokens, model, session };
		}
	}
	if (limits.size > 0) {
		const draft = blank("context:limit", "contextLimit");
		Object.assign(draft, linksOf(limits));
		draft.count = [...limits.values()].reduce((sum, entry) => sum + entry.count, 0);
		const figures: Partial<Record<FindingFigure, Figure>> = {
			peak: { value: peak?.tokens ?? 0, origin: "recorded" },
		};
		const model = peak?.model || null;
		const catalog = model ? peak?.session.digest.models.get(model)?.catalog : null;
		const window = catalog
			? await (input.contextWindow?.(catalog.provider, catalog.id) ?? null)
			: null;
		if (window !== null) figures.window = { value: window, origin: "host" };
		draft.figures = figures;
		draft.subject = model;
		draft.last = lastOf(sessions, draft.sessions);
		out.push(draft);
	}
	const misses = new Map<number, { count: number; events: string[] }>();
	const causes = new Map<string, number>();
	let rewritten = 0;
	let calls = 0;
	for (const { index, digest } of sessions) {
		for (const use of digest.models.values()) calls += use.calls;
		if (digest.misses.count === 0) continue;
		note(misses, index, digest.misses.count, digest.misses.events);
		rewritten += digest.misses.rewritten;
		for (const [cause, count] of digest.misses.causes)
			causes.set(cause, (causes.get(cause) ?? 0) + count);
	}
	const missCount = [...misses.values()].reduce((sum, entry) => sum + entry.count, 0);
	if (missCount >= R.cacheMisses) {
		const draft = blank("cache:misses", "cacheMisses");
		Object.assign(draft, linksOf(misses));
		draft.count = missCount;
		draft.total = calls;
		draft.shares = [...causes]
			.map(([key, count]) => ({ key, count }))
			.sort((a, b) => b.count - a.count || byText(a.key, b.key));
		draft.figures = { rewritten: { value: rewritten, origin: "recorded" } };
		draft.last = lastOf(sessions, draft.sessions);
		out.push(draft);
	}
	const priced = outliers(
		sessions.filter(({ row }) => row.cost.origin !== "notRecorded"),
		({ row }) => row.cost.value ?? 0,
		R.outlierFactor,
		R.outlierSessions,
	);
	const unpriced = outliers(
		sessions.filter(({ row }) => row.cost.origin === "notRecorded"),
		({ row }) => row.tokens.value?.total ?? 0,
		R.outlierFactor,
		R.outlierSessions,
	);
	for (const [rule, found, value, considered] of [
		[
			"costOutlier",
			priced,
			(session: ScopedSession) => session.row.cost.value ?? 0,
			sessions.filter(({ row }) => row.cost.origin !== "notRecorded" && (row.cost.value ?? 0) > 0),
		],
		[
			"tokenOutlier",
			unpriced,
			(session: ScopedSession) => session.row.tokens.value?.total ?? 0,
			sessions.filter(
				({ row }) => row.cost.origin === "notRecorded" && (row.tokens.value?.total ?? 0) > 0,
			),
		],
	] as const) {
		if (!found || found.items.length === 0) continue;
		const ranked = [...found.items].sort((a, b) => value(b) - value(a) || a.index - b.index);
		const largest = value(ranked[0] as ScopedSession);
		const draft = blank(rule === "costOutlier" ? "outliers:cost" : "outliers:tokens", rule);
		draft.count = ranked.length;
		draft.total = considered.length;
		draft.ratio = largest / found.median;
		draft.figures = {
			median: { value: found.median, origin: "recorded" },
			largest: { value: largest, origin: "recorded" },
		};
		draft.links = ranked
			.slice(0, LINKS)
			.map((session) => ({ session: session.index, count: 1, events: [], value: value(session) }));
		draft.sessions = ranked.map((session) => session.index).sort((a, b) => a - b);
		draft.last = lastOf(sessions, draft.sessions);
		out.push(draft);
	}
	const outside = sessions
		.filter(({ row }) => (row.subagentsOutside.value?.cost ?? 0) > R.outsideCost)
		.sort(
			(a, b) =>
				(b.row.subagentsOutside.value?.cost ?? 0) - (a.row.subagentsOutside.value?.cost ?? 0) ||
				a.index - b.index,
		);
	if (outside.length > 0) {
		const draft = blank("subagents:outside", "subagentsOutside");
		const extra = outside.reduce(
			(sum, { row }) => sum + (row.subagentsOutside.value?.cost ?? 0),
			0,
		);
		const recorded = outside.reduce((sum, { row }) => sum + (row.cost.value ?? 0), 0);
		draft.count = outside.length;
		draft.figures = {
			outside: { value: extra, origin: "recorded" },
			recorded: { value: recorded, origin: "recorded" },
		};
		draft.ratio = recorded > 0 ? extra / recorded : null;
		draft.links = outside.slice(0, LINKS).map(({ index, row }) => ({
			session: index,
			count: 1,
			events: [],
			value: row.subagentsOutside.value?.cost ?? 0,
		}));
		draft.sessions = outside.map(({ index }) => index).sort((a, b) => a - b);
		draft.last = lastOf(sessions, draft.sessions);
		out.push(draft);
	}
	return out;
}

function fileFindings(sessions: readonly ScopedSession[], input: StatsInput): Draft[] {
	const out: Draft[] = [];
	const names = new Map(input.projects.map((project) => [project.id, project.name]));
	const rework = sessions
		.flatMap((session) =>
			[...session.digest.files].flatMap(([path, file]) =>
				file.edits + file.writes >= REWORK_CHANGES ? [{ session, path, file }] : [],
			),
		)
		.sort(
			(a, b) =>
				b.file.edits + b.file.writes - (a.file.edits + a.file.writes) ||
				a.session.index - b.session.index ||
				byText(a.path, b.path),
		);
	const seen = new Set<string>();
	for (const { session, path, file } of rework) {
		const id = `rework:${session.row.projectId ?? ""}:${path}`;
		if (seen.has(id)) continue;
		seen.add(id);
		if (seen.size > R.reworkFiles) break;
		const draft = blank(id, "rework");
		draft.subject = path;
		draft.count = file.edits + file.writes;
		draft.total = file.reads;
		draft.names = session.row.projectId ? [names.get(session.row.projectId) ?? ""] : [];
		draft.links = [
			{ session: session.index, count: file.edits + file.writes, events: file.events.slice(0, 3) },
		];
		draft.sessions = [session.index];
		draft.last = session.summary.end;
		out.push(draft);
	}
	const items: SentenceItem[] = [];
	for (const session of [...sessions].sort((a, b) => b.index - a.index))
		for (const { eventId, sentence } of session.digest.sentences)
			items.push({ session: session.index, eventId, sentence });
	const clusters = clusterSentences(items, R.repeatSimilarity, R.repeatSessions).slice(
		0,
		R.repeatFindings,
	);
	for (const cluster of clusters) {
		const first = items[cluster.members[0] ?? 0];
		if (!first) continue;
		const entries = new Map<number, { count: number; events: string[] }>();
		for (const member of cluster.members) {
			const item = items[member];
			if (item) note(entries, item.session, 1, [item.eventId]);
		}
		const draft = blank(
			`repeat:${hash(first.sentence.excerpt.toLowerCase())}`,
			"repeatedInstruction",
		);
		draft.subject = first.sentence.excerpt;
		draft.count = cluster.members.length;
		draft.total = cluster.sessions.length;
		Object.assign(draft, linksOf(entries));
		draft.last = lastOf(sessions, draft.sessions);
		out.push(draft);
	}
	const claims = new Map<number, { count: number; events: string[] }>();
	for (const { index, digest } of sessions)
		if (digest.unverified.length > 0)
			note(claims, index, digest.unverified.length, digest.unverified);
	const claimCount = [...claims.values()].reduce((sum, entry) => sum + entry.count, 0);
	if (claimCount >= R.unverifiedClaims) {
		const draft = blank("claims:unverified", "unverifiedClaim");
		draft.count = claimCount;
		Object.assign(draft, linksOf(claims));
		draft.last = lastOf(sessions, draft.sessions);
		out.push(draft);
	}
	return out;
}

function hash(text: string): string {
	let value = 0x811c9dc5;
	for (let at = 0; at < text.length; at++) {
		value ^= text.charCodeAt(at);
		value = Math.imul(value, 0x01000193);
	}
	return (value >>> 0).toString(36);
}

/** Every rule over the scope's built digests, in group and rule order. Deterministic. */
export async function buildFindings(
	input: StatsInput,
	sessions: readonly ScopedSession[],
	hidden: ReadonlySet<string>,
	redactor: Redactor = createRedactor(),
): Promise<Finding[]> {
	const drafts = [
		...skillFindings(sessions),
		...(await commandFindings(sessions, redactor)),
		...toolFindings(sessions),
		...(await contextFindings(sessions, input)),
		...fileFindings(sessions, input),
	];
	return drafts
		.map((draft) => ({
			...draft,
			group: RULE_GROUP[draft.rule],
			severity: RULE_SEVERITY[draft.rule],
			heuristic: HEURISTIC.has(draft.rule),
			hidden: hidden.has(draft.id),
		}))
		.sort(
			(a, b) =>
				GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
				RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule) ||
				b.count - a.count ||
				byText(a.id, b.id),
		);
}

/** `findings.list`: the evidence cards of the scope, each flagged when the user hid it. */
export async function buildFindingsList(
	input: StatsInput & { store: JsonStore; redactor?: Redactor },
	state: IndexState,
): Promise<FindingsListResult> {
	const scope = await statsScope(input, state);
	const { hidden } = await input.store.read(HIDDEN_FINDINGS, parseHidden);
	return {
		apiVersion: SESSION_INSIGHTS_API_VERSION,
		state,
		digests: scope.progress,
		sessions: scope.sessions,
		findings: await buildFindings(input, scope.ready, new Set(hidden), input.redactor),
		rules: FINDING_RULES,
		exits: KNOWN_EXIT_CODES,
		sources: METRIC_SOURCES,
	};
}
