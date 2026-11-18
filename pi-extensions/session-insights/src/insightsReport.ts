import type {
	ContextLimit,
	CostDiagnosis,
	ExportResult,
	Figure,
	Finding,
	MissCause,
	Origin,
	SessionAnalysis,
	SessionCost,
	SessionListRow,
	SessionOverview,
	SessionRef,
	SessionTimeline,
	StatsUsage,
	TokenTotals,
} from "./core.ts";
import type { Redactor } from "./redact.ts";

/** Findings the overview lists before it says how many more there are. */
export const REPORT_FINDINGS = 8;
/** Recent sessions the overview lists. */
export const REPORT_SESSIONS = 5;
/** Turns a session report lists before it says how many more there are. */
export const REPORT_TURNS = 12;

const TOP_MODELS = 3;
const TOP_TOOLS = 5;
const TOP_FOLDERS = 5;
const QUOTE_CHARS = 72;
const LABEL_CHARS = 48;
const SUBJECT_CHARS = 60;

export type InsightsScope = { kind: "cwd"; cwd: string } | { kind: "all" };

/** An export the command wrote (or failed to write), with the absolute path of what it wrote. */
export interface ExportLine {
	result: ExportResult;
	path: string | null;
}

export interface OverviewReportInput {
	scope: InsightsScope;
	sessionsRoot: string;
	/** Every indexed session, in or out of scope (for the empty-scope hint). */
	indexed: number;
	/** The list rows in scope, newest first. */
	rows: readonly SessionListRow[];
	usage: StatsUsage;
	findings: readonly Finding[];
	/** The sessions the findings' links index into. */
	findingSessions: readonly SessionRef[];
	/** A session's shortest unique id prefix. */
	shortId(sessionId: string): string;
	redactor: Redactor;
	exports: readonly ExportLine[];
}

/** The highest context one model call of the session asked for, with its model's window. */
export interface ContextPeak {
	tokens: number;
	model: string | null;
	limit: ContextLimit | null;
}

export interface SessionReportInput {
	overview: SessionOverview;
	shortId: string;
	cwd: string | null;
	timeline: SessionTimeline;
	analysis: SessionAnalysis;
	cost: SessionCost;
	peak: ContextPeak | null;
	/** Each turn's one-line, redacted label by its event id. */
	turnLabels: ReadonlyMap<string, string>;
	redactor: Redactor;
	exports: readonly ExportLine[];
}

// ── Numbers ──

function count(value: number): string {
	return Math.round(value).toLocaleString("en-US");
}

/** `940`, `12.3k`, `230k`, `4.1M`, `12M`. */
export function tokensText(value: number): string {
	const n = Math.max(0, Math.round(value));
	if (n < 1000) return String(n);
	if (n < 10_000) return `${trimZero((n / 1000).toFixed(1))}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	if (n < 10_000_000) return `${trimZero((n / 1_000_000).toFixed(1))}M`;
	if (n < 1_000_000_000) return `${Math.round(n / 1_000_000)}M`;
	return `${trimZero((n / 1_000_000_000).toFixed(1))}B`;
}

function trimZero(text: string): string {
	return text.endsWith(".0") ? text.slice(0, -2) : text;
}

/** `$0.00`, `<$0.01`, `$0.42`, `$12.34`, `$1,234`. */
export function moneyText(value: number): string {
	if (value <= 0) return "$0.00";
	if (value < 0.01) return "<$0.01";
	if (value < 100) return `$${value.toFixed(2)}`;
	return `$${count(value)}`;
}

function share(part: number, whole: number): string {
	if (whole <= 0) return "0%";
	const value = (100 * part) / whole;
	return value > 0 && value < 1 ? "<1%" : `${Math.round(value)}%`;
}

/** `45 s`, `12 m`, `1 h 12 m`, `3 d 4 h`. */
export function durationText(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds} s`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} m` : `${hours} h`;
	const days = Math.floor(hours / 24);
	return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

/** `2026-11-16` in the host's local time zone. */
function dayText(t: number): string {
	const date = new Date(t);
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function clockText(t: number): string {
	const date = new Date(t);
	return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function plural(n: number, one: string, other = `${one}s`): string {
	return `${count(n)} ${n === 1 ? one : other}`;
}

// ── Provenance marks ──

/** `≈` an estimate, `≥` a lower bound (partly recorded), `?` not measured or not recorded. */
const MARKS: Partial<Readonly<Record<Origin, string>>> = {
	approximated: "≈",
	partiallyRecorded: "≥",
	notRecorded: "?",
	notMeasured: "?",
};

const LEGEND: readonly (readonly [string, string])[] = [
	["≈", "estimate"],
	["≥", "partly recorded (a lower bound)"],
	["?", "not measured or not recorded"],
];

/** Collects the marks a report used, so its legend names only those. */
class Marks {
	private readonly used = new Set<string>();

	/** `≈text`, `≥text`, `text?`, or the text alone; an unknown value is the mark alone. */
	figure(text: string | null, origin: Origin): string {
		const mark = MARKS[origin];
		if (!mark) return text ?? "–";
		this.used.add(mark);
		if (text === null) return mark;
		return mark === "?" ? `${text}?` : `${mark}${text}`;
	}

	note(mark: string): void {
		this.used.add(mark);
	}

	legend(): string | null {
		const parts = LEGEND.filter(([mark]) => this.used.has(mark)).map(
			([mark, text]) => `${mark} ${text}`,
		);
		return parts.length > 0 ? parts.join(" · ") : null;
	}
}

function costFigure(marks: Marks, cost: Figure, tokens: number): string {
	if (cost.origin === "notRecorded") {
		marks.note("?");
		return `not recorded? (${tokensText(tokens)} tokens)`;
	}
	return marks.figure(moneyText(cost.value ?? 0), cost.origin);
}

/** The cost field: pi's recorded total, saying so when some or all calls record no cost. */
function costLine(marks: Marks, cost: Figure, tokens: number): string {
	const figure = costFigure(marks, cost, tokens);
	if (cost.origin === "notRecorded") return figure;
	if (cost.origin === "partiallyRecorded")
		return `${figure} recorded by pi; some calls record no cost`;
	return `${figure} recorded by pi`;
}

function tokenBreakdown(tokens: TokenTotals): string {
	return `${tokensText(tokens.total)} (input ${tokensText(tokens.input)}, output ${tokensText(tokens.output)}, cache read ${tokensText(tokens.cacheRead)}, cache write ${tokensText(tokens.cacheWrite)})`;
}

function outsideLine(
	marks: Marks,
	outside: Figure<{ cost: number; tokens: number }>,
	headline: "cost" | "tokens",
): string | null {
	const value = outside.value ?? { cost: 0, tokens: 0 };
	const known = value.cost > 0 || value.tokens > 0;
	if (!known && outside.origin !== "notMeasured") return null;
	if (!known) {
		marks.note("?");
		return "+ ? subagent spend outside pi's total (a subagent could not be measured)";
	}
	const amount =
		headline === "cost" && value.cost > 0
			? moneyText(value.cost)
			: `${tokensText(value.tokens)} tokens`;
	return `+ ${marks.figure(amount, outside.origin)} subagent spend outside pi's total`;
}

function quoted(text: string, max: number, redactor: Redactor): string {
	return `“${redactor.label(text, max)}”`;
}

function field(label: string, value: string): string {
	return `  ${label.padEnd(10)}${value}`;
}

function scopeText(scope: InsightsScope, redactor: Redactor): string {
	return scope.kind === "all" ? "all folders" : redactor.redact(scope.cwd);
}

// ── Findings ──

const SEVERITY_ORDER = ["error", "warning", "info"] as const;
const SEVERITY_GLYPH = { error: "✗", warning: "!", info: "·" } as const;

const EXIT_MEANING: Readonly<Record<string, string>> = {
	checksPending: "checks still pending",
	noMatch: "no match",
	differences: "differences found",
	conditionFalse: "a false condition",
};

const MISS_CAUSE: Readonly<Record<MissCause, string>> = {
	modelChange: "model switch",
	modelReselected: "model re-selected",
	systemPrompt: "system prompt changed",
	tools: "tools changed",
	compaction: "compaction",
	contextEdit: "context edit",
	thinkingLevel: "thinking level changed",
	pause: "pause over 5 min",
};
/** The findings count misses with no visible cause under `none`. */
const MISS_CAUSES = new Map<string, string>([
	...Object.entries(MISS_CAUSE),
	["none", "no visible cause"],
]);

function inSessions(finding: Finding): string {
	return `in ${plural(finding.sessions.length, "session")}`;
}

function rateText(finding: Finding): string {
	const rate = finding.rate;
	if (!rate) return "";
	return ` (${share(rate.k, rate.n)}, 95% CI ${Math.round(rate.low * 100)}–${Math.round(rate.high * 100)}%)`;
}

function figureValue(finding: Finding, name: keyof Finding["figures"]): number | null {
	return finding.figures[name]?.value ?? null;
}

interface FindingContext {
	sessions: readonly SessionRef[];
	shortId(sessionId: string): string;
	redactor: Redactor;
	marks: Marks;
}

function linkedIds(finding: Finding, context: FindingContext, money: boolean, max = 2): string {
	return finding.links
		.slice(0, max)
		.map((link) => {
			const ref = context.sessions[link.session];
			const id = ref ? context.shortId(ref.sessionId) : "?";
			const value = link.value ?? 0;
			return `${money ? moneyText(value) : tokensText(value)} (${id})`;
		})
		.join(", ");
}

/** One finding as a line of text (and an optional quoted detail), from the fixed rule templates. */
function findingText(
	finding: Finding,
	context: FindingContext,
): { text: string; detail: string | null } {
	const { redactor, marks } = context;
	const subject = finding.subject ? quoted(finding.subject, SUBJECT_CHARS, redactor) : "";
	const total = finding.total ?? 0;
	switch (finding.rule) {
		case "commandFailing":
			return {
				text: `${subject} fails in ${count(finding.count)} of ${count(total)} runs${rateText(finding)} ${inSessions(finding)}`,
				detail: finding.quote ? quoted(finding.quote.text, QUOTE_CHARS, redactor) : null,
			};
		case "falseError": {
			const meaning = EXIT_MEANING[finding.names[0] ?? ""] ?? "an answer";
			const exit = finding.shares[0]?.key ?? "?";
			return {
				text: `${subject} exit ${exit} means ${meaning}, not a failure: ${count(finding.count)} of its ${count(total)} recorded failures ${inSessions(finding)}`,
				detail: null,
			};
		}
		case "loop":
			return {
				text: `The same ${subject} call repeated in a row ${plural(finding.count, "time")} (up to ${count(finding.ratio ?? 0)} in a row) ${inSessions(finding)}`,
				detail: null,
			};
		case "poorRecovery":
			return {
				text: `Failures of ${subject} rarely recover: ${count(finding.count)} of ${count(total)} chains recovered by a retry${rateText(finding)} ${inSessions(finding)} (heuristic)`,
				detail: null,
			};
		case "oversizedOutput":
			return {
				text: `${subject} returned 50,000+ characters ${plural(finding.count, "time")} (largest ${count(figureValue(finding, "largestOutput") ?? 0)}) ${inSessions(finding)}`,
				detail: null,
			};
		case "contextLimit": {
			const peak = figureValue(finding, "peak");
			const window = figureValue(finding, "window");
			const windowText = window === null ? "" : ` of a ${tokensText(window)} window`;
			return {
				text: `The context hit the window's limit ${plural(finding.count, "time")} ${inSessions(finding)}; peak ${tokensText(peak ?? 0)} tokens${windowText}`,
				detail: null,
			};
		}
		case "cacheMisses": {
			const causes = finding.shares
				.slice(0, 3)
				.map((cause) => `${MISS_CAUSES.get(cause.key) ?? cause.key} ${count(cause.count)}`)
				.join(", ");
			return {
				text: `${plural(finding.count, "cache miss", "cache misses")} in ${count(total)} model calls wrote ${tokensText(figureValue(finding, "rewritten") ?? 0)} tokens to the cache again${causes ? `; causes: ${causes}` : ""} (heuristic)`,
				detail: null,
			};
		}
		case "costOutlier":
		case "tokenOutlier": {
			const money = finding.rule === "costOutlier";
			const median = figureValue(finding, "median") ?? 0;
			const what = money ? "cost" : "used tokens";
			return {
				text: `${plural(finding.count, "session")} ${what} over 3× the median ${money ? moneyText(median) : tokensText(median)}: ${linkedIds(finding, context, money)}; largest ${(finding.ratio ?? 0).toFixed(1)}×`,
				detail: null,
			};
		}
		case "subagentsOutside": {
			const outside = figureValue(finding, "outside") ?? 0;
			const recorded = figureValue(finding, "recorded") ?? 0;
			return {
				text: `pi's total misses ${moneyText(outside)} of subagent spend ${inSessions(finding)} (pi recorded ${moneyText(recorded)} there)`,
				detail: null,
			};
		}
		case "rework": {
			const ref = context.sessions[finding.links[0]?.session ?? -1];
			const where = ref ? ` (${context.shortId(ref.sessionId)})` : "";
			return {
				text: `Rework: ${redactor.label(finding.subject ?? "", SUBJECT_CHARS)} changed ${count(finding.count)} times in one session${where}`,
				detail: null,
			};
		}
		case "repeatedInstruction":
			return {
				text: `You repeated an instruction ${plural(finding.count, "time")} ${inSessions(finding)} (heuristic)`,
				detail: subject || null,
			};
		case "unverifiedClaim":
			return {
				text: `“Tests pass” said ${plural(finding.count, "time")} ${inSessions(finding)} with no test command since the last edit (heuristic)`,
				detail: null,
			};
		case "skillNeverLoaded": {
			const tokens = finding.figures.perRequest;
			const cost = tokens ? marks.figure(tokensText(tokens.value ?? 0), tokens.origin) : "?";
			const names = finding.names.slice(0, 4).join(", ");
			const more = finding.names.length > 4 ? `, +${finding.names.length - 4} more` : "";
			return {
				text: `${plural(finding.count, "skill")} listed but never loaded: ${names}${more} (${cost} tokens with every request)`,
				detail: null,
			};
		}
		case "skillUnlisted":
			return {
				text: `Skills read without being listed: ${finding.shares
					.slice(0, 4)
					.map((item) => `${item.key} (${count(item.count)})`)
					.join(", ")}`,
				detail: null,
			};
	}
}

function findingLines(findings: readonly Finding[], context: FindingContext): string[] {
	const shown = findings
		.filter((finding) => !finding.hidden)
		.map((finding, order) => ({ finding, order }))
		.sort(
			(a, b) =>
				SEVERITY_ORDER.indexOf(a.finding.severity) - SEVERITY_ORDER.indexOf(b.finding.severity) ||
				a.order - b.order,
		)
		.map(({ finding }) => finding);
	if (shown.length === 0) return ["  Nothing stands out: no rule matched these sessions."];
	const lines: string[] = [];
	for (const finding of shown.slice(0, REPORT_FINDINGS)) {
		const { text, detail } = findingText(finding, context);
		lines.push(`  ${SEVERITY_GLYPH[finding.severity]} ${text}`);
		if (detail) lines.push(`      ${detail}`);
	}
	if (shown.length > REPORT_FINDINGS)
		lines.push(`  … and ${plural(shown.length - REPORT_FINDINGS, "more finding")}`);
	return lines;
}

// ── Exports ──

const EXPORT_LABEL = { html: "HTML", trace: "Trace", fixture: "Fixture" } as const;

function exportLines(exports: readonly ExportLine[]): string[] {
	if (exports.length === 0) return [];
	const lines = ["", "Exported"];
	for (const { result, path } of exports) {
		const label = EXPORT_LABEL[result.kind];
		if (result.ok) {
			const hint = result.kind === "trace" ? " (Perfetto UI, chrome://tracing or speedscope)" : "";
			lines.push(field(label, `${path ?? result.path}${hint}`));
		} else if (result.code === "CHECK_FAILED") {
			lines.push(
				field(
					label,
					`not written: the secret check found ${result.found.join(", ")} after masking`,
				),
			);
		} else {
			lines.push(
				field(label, `not written (${result.code}${result.detail ? `: ${result.detail}` : ""})`),
			);
		}
	}
	return lines;
}

function footer(marks: Marks): string[] {
	const legend = marks.legend();
	return [
		"",
		...(legend ? [legend] : []),
		"Computed on this machine from pi's session files; nothing was sent anywhere.",
	];
}

// ── The overview ──

function sessionLabel(row: SessionListRow, redactor: Redactor): string {
	const text = row.title ?? row.firstPrompt;
	return text ? redactor.label(text, LABEL_CHARS) : "";
}

function usageLines(input: OverviewReportInput, marks: Marks): string[] {
	const { usage, rows, redactor } = input;
	const lines = ["", "Usage"];
	const active = rows.reduce((sum, row) => sum + (row.activeMs.value ?? 0), 0);
	const toolCalls = rows.reduce((sum, row) => sum + (row.toolCalls.value ?? 0), 0);
	const toolErrors = rows.reduce((sum, row) => sum + (row.toolErrors.value ?? 0), 0);
	const subagents = rows.reduce((sum, row) => sum + (row.subagents.value ?? 0), 0);
	const subagentsUnmeasured = rows.some((row) => row.subagents.origin === "notMeasured");
	const parts = [
		count(rows.length),
		`active ${marks.figure(durationText(active), "approximated")}`,
		`${plural(toolCalls, "tool call")} (${count(toolErrors)} failed)`,
	];
	if (subagents > 0 || subagentsUnmeasured)
		parts.push(
			`${marks.figure(count(subagents), subagentsUnmeasured ? "notMeasured" : "counted")} subagent ${subagents === 1 ? "run" : "runs"}`,
		);
	lines.push(field("Sessions", parts.join(" · ")));
	const tokens = usage.totals.tokens.value;
	if (tokens) lines.push(field("Tokens", tokenBreakdown(tokens)));
	lines.push(field("Cost", costLine(marks, usage.totals.cost, tokens?.total ?? 0)));
	const outside = outsideLine(marks, usage.totals.outside, usage.headline);
	if (outside) lines.push(field("", outside));
	const byCost = usage.headline === "cost";
	const value = (figure: { cost: Figure; tokens: Figure<TokenTotals> }) =>
		byCost ? (figure.cost.value ?? 0) : (figure.tokens.value?.total ?? 0);
	const models = [...usage.models].sort(
		(a, b) => value(b) - value(a) || (a.model < b.model ? -1 : 1),
	);
	const modelTotal = models.reduce((sum, row) => sum + value(row), 0);
	if (models.length > 0)
		lines.push(
			field(
				"Models",
				models
					.slice(0, TOP_MODELS)
					.map((row) =>
						byCost && row.cost.origin === "notRecorded"
							? `${row.model} ${tokensText(row.tokens.value?.total ?? 0)} tokens (cost ${marks.figure("not recorded", "notRecorded")})`
							: `${row.model} ${byCost ? moneyText(value(row)) : tokensText(value(row))} (${share(value(row), modelTotal)})`,
					)
					.join(" · ") +
					(models.length > TOP_MODELS ? ` · +${models.length - TOP_MODELS} more` : ""),
			),
		);
	if (usage.tools.length > 0)
		lines.push(
			field(
				"Tools",
				usage.tools
					.slice(0, TOP_TOOLS)
					.map((row) => {
						const errors = row.errors.value ?? 0;
						const notes = [
							errors > 0 ? `${count(errors)} failed` : null,
							row.notRun > 0 ? `${count(row.notRun)} not run` : null,
						].filter((note): note is string => note !== null);
						const calls = `${row.name} ${count(row.calls.value ?? 0)}`;
						return notes.length > 0 ? `${calls} (${notes.join(", ")})` : calls;
					})
					.join(" · "),
			),
		);
	if (input.scope.kind === "all" && usage.projects.length > 1) {
		const folders = [...usage.projects].sort(
			(a, b) => value(b) - value(a) || ((a.name ?? "") < (b.name ?? "") ? -1 : 1),
		);
		lines.push(
			field(
				"Folders",
				folders
					.slice(0, TOP_FOLDERS)
					.map(
						(row) =>
							`${redactor.redact(row.name ?? "?")} ${byCost ? moneyText(value(row)) : tokensText(value(row))}`,
					)
					.join(" · ") +
					(folders.length > TOP_FOLDERS ? ` · +${folders.length - TOP_FOLDERS} more` : ""),
			),
		);
	}
	return lines;
}

function recentLines(input: OverviewReportInput, marks: Marks): string[] {
	const { rows, redactor } = input;
	const shown = rows.slice(0, REPORT_SESSIONS);
	const lines = ["", `Recent sessions (${count(shown.length)} of ${count(rows.length)})`];
	const ids = shown.map((row) => input.shortId(row.sessionId));
	const width = Math.max(...ids.map((id) => id.length));
	shown.forEach((row, at) => {
		const start =
			row.start.value === null ? "?" : `${dayText(row.start.value)} ${clockText(row.start.value)}`;
		const cost =
			row.cost.origin === "notRecorded"
				? `${tokensText(row.tokens.value?.total ?? 0)} tok`
				: marks.figure(moneyText(row.cost.value ?? 0), row.cost.origin);
		const calls = `${plural(row.toolCalls.value ?? 0, "call")}${(row.toolErrors.value ?? 0) > 0 ? ` (${count(row.toolErrors.value ?? 0)} failed)` : ""}`;
		const label = sessionLabel(row, redactor);
		lines.push(
			`  ${(ids[at] ?? "").padEnd(width)}  ${start.padEnd(16)}  ${cost.padStart(8)}  ${calls.padEnd(20)}  ${label}`.trimEnd(),
		);
	});
	return lines;
}

/** The scope's report: top findings, the usage summary and the latest sessions, as plain text. */
export function overviewReport(input: OverviewReportInput): string {
	const marks = new Marks();
	const { rows, redactor, scope } = input;
	const where = scopeText(scope, redactor);
	if (rows.length === 0) {
		const lines = [
			input.indexed === 0
				? `No pi sessions found in ${redactor.redact(input.sessionsRoot)}.`
				: `No pi sessions were started in ${where}.`,
		];
		if (input.indexed > 0 && scope.kind === "cwd")
			lines.push(
				`${plural(input.indexed, "session")} in other folders: run /insights --all to include them.`,
			);
		return [...lines, ...exportLines(input.exports), ...footer(marks)].join("\n");
	}
	const starts = rows.flatMap((row) => (row.start.value === null ? [] : [row.start.value]));
	const range =
		starts.length > 0 ? ` · ${dayText(Math.min(...starts))} – ${dayText(Math.max(...starts))}` : "";
	const lines = [
		`Session insights · ${where} · ${plural(rows.length, "session")}${range}`,
		"",
		"Top findings",
		...findingLines(input.findings, {
			sessions: input.findingSessions,
			shortId: input.shortId,
			redactor,
			marks,
		}),
		...usageLines(input, marks),
		...recentLines(input, marks),
		...exportLines(input.exports),
		...footer(marks),
		scope.kind === "cwd"
			? "More: /insights --all · /insights --session <id> · --html · --trace · --help"
			: "More: /insights --session <id> · --html · --trace · --help",
	];
	return lines.join("\n");
}

// ── One session ──

function diagnosisText(cost: SessionCost): string {
	const d: CostDiagnosis = cost.diagnosis;
	const value = (amount: number) =>
		cost.headline === "tokens" ? `${tokensText(amount)} tokens` : moneyText(amount);
	const focus = d.focus
		? `; ${share(d.focus.share, 1)} of the spend went to ${d.focus.kind === "steps" ? "plan steps" : "turns"} ${d.focus.items
				.map((item) => `${item.n} “${item.title}”`)
				.join(" and ")} at a context up to ${tokensText(d.focus.peakContext)}`
		: "";
	const total = cost.total.value ?? 0;
	switch (d.kind) {
		case "none":
			return "Nothing was spent in this session.";
		case "longContext":
			return `Expensive because of a long context: ${count(d.calls)} calls re-read ${tokensText(d.averageContext)} tokens on average${focus}.`;
		case "cacheRewrites":
			return `Expensive because of cache rewrites: ${count(d.rewrites?.calls ?? 0)} calls wrote a large context to the cache again — ${value(d.rewrites?.value ?? 0)}, ${share(d.rewrites?.value ?? 0, total)} of the spend${focus}.`;
		case "manyCalls":
			return `Expensive because of many calls: ${count(d.calls)} model calls at a median ${value(d.medianCall)} each${focus}.`;
		case "spread":
			return `No single cause stands out: ${count(d.calls)} calls at a median ${value(d.medianCall)}${focus}.`;
	}
}

function errorLines(analysis: SessionAnalysis, redactor: Redactor): string[] {
	const tool = analysis.toolRecovery.reduce(
		(sum, row) => ({
			failures: sum.failures + row.failures,
			chains: sum.chains + row.chains,
			recovered: sum.recovered + row.recovered,
			changed: sum.changed + row.changedApproach,
			gaveUp: sum.gaveUp + row.gaveUp,
			unfinished: sum.unfinished + row.unfinished,
		}),
		{ failures: 0, chains: 0, recovered: 0, changed: 0, gaveUp: 0, unfinished: 0 },
	);
	const model = analysis.modelRecovery;
	if (tool.failures === 0 && model.failures === 0) return [field("Errors", "none")];
	const lines: string[] = [];
	if (tool.failures > 0) {
		const outcomes = [
			tool.recovered > 0 ? `${count(tool.recovered)} recovered` : null,
			tool.changed > 0 ? `${count(tool.changed)} changed approach` : null,
			tool.gaveUp > 0 ? `${count(tool.gaveUp)} gave up` : null,
			tool.unfinished > 0 ? `${count(tool.unfinished)} unfinished (the retry got no result)` : null,
		].filter((part): part is string => part !== null);
		lines.push(
			field(
				"Errors",
				`${plural(tool.failures, "tool failure")} in ${plural(tool.chains, "chain")}: ${outcomes.join(", ")} (retries are a heuristic)`,
			),
		);
	}
	if (model.failures > 0) {
		const outcomes = [
			model.sameModel > 0 ? `${count(model.sameModel)} recovered on the same model` : null,
			model.afterSwitch > 0 ? `${count(model.afterSwitch)} after a model switch` : null,
			model.never > 0 ? `${count(model.never)} never recovered` : null,
		].filter((part): part is string => part !== null);
		lines.push(
			field(
				tool.failures > 0 ? "" : "Errors",
				`${plural(model.failures, "failed model call")}: ${outcomes.join(", ")}`,
			),
		);
	}
	const top = [...analysis.clusters].sort(
		(a, b) => b.ids.length - a.ids.length || a.index - b.index,
	)[0];
	if (top && top.ids.length > 1) {
		const tool = top.tools[0]?.tool ?? (top.kind === "model" ? "model" : "?");
		lines.push(
			field(
				"",
				`most common: ${tool} ×${count(top.ids.length)} ${quoted(top.sample, QUOTE_CHARS, redactor)}`,
			),
		);
	}
	return lines;
}

function turnLines(input: SessionReportInput, marks: Marks): string[] {
	const { timeline, turnLabels, redactor } = input;
	if (timeline.turns.length === 0) return [];
	const lines = ["", "Turns"];
	const byCost = timeline.headline === "cost";
	for (const turn of timeline.turns.slice(0, REPORT_TURNS)) {
		const duration = marks.figure(durationText(turn.duration.value ?? 0), turn.duration.origin);
		const calls = `${plural(turn.toolCalls.value ?? 0, "call")}${(turn.errors.value ?? 0) > 0 ? ` (${count(turn.errors.value ?? 0)} failed)` : ""}`;
		const spend = byCost
			? marks.figure(moneyText(turn.cost.value ?? 0), turn.cost.origin)
			: `${tokensText(turn.tokens.value?.total ?? 0)} tok`;
		const label = redactor.label(turnLabels.get(turn.id) ?? "", LABEL_CHARS);
		lines.push(
			`  ${String(turn.n).padStart(3)}  ${clockText(turn.t0)}  ${duration.padEnd(9)} ${calls.padEnd(18)} ${spend.padStart(8)}  ${label}`.trimEnd(),
		);
	}
	if (timeline.turns.length > REPORT_TURNS)
		lines.push(`  … and ${plural(timeline.turns.length - REPORT_TURNS, "more turn")}`);
	return lines;
}

/** One session's report: the work, spend, context peak, why it cost what it did, errors and turns. */
export function sessionReport(input: SessionReportInput): string {
	const marks = new Marks();
	const { overview, timeline, cost, peak, redactor } = input;
	const title = overview.title ?? overview.firstPrompt;
	const lines = [`Session ${input.shortId}${title ? ` · ${redactor.label(title, 80)}` : ""}`, ""];
	if (input.cwd) lines.push(field("Folder", redactor.redact(input.cwd)));
	const start = overview.start.value;
	lines.push(
		field(
			"Started",
			[
				start === null ? "?" : `${dayText(start)} ${clockText(start)}`,
				`wall ${marks.figure(overview.wallMs.value === null ? null : durationText(overview.wallMs.value), overview.wallMs.origin)}`,
				`active ${marks.figure(durationText(overview.activeMs.value ?? 0), overview.activeMs.origin)}`,
			].join(" · "),
		),
	);
	const subagents = overview.subagents.value ?? 0;
	lines.push(
		field(
			"Work",
			[
				plural(timeline.turns.length, "turn"),
				plural(cost.calls.length, "model call"),
				`${plural(overview.toolCalls.value ?? 0, "tool call")} (${count(overview.toolErrors.value ?? 0)} failed)`,
				...(subagents > 0 || overview.subagents.origin === "notMeasured"
					? [
							`${marks.figure(count(subagents), overview.subagents.origin)} ${subagents === 1 ? "subagent" : "subagents"}`,
						]
					: []),
			].join(" · "),
		),
	);
	const tokens = overview.tokens.value;
	if (tokens) lines.push(field("Tokens", tokenBreakdown(tokens)));
	lines.push(field("Cost", costLine(marks, overview.cost, tokens?.total ?? 0)));
	const outside = outsideLine(marks, overview.subagentsOutside, cost.headline);
	if (outside) lines.push(field("", outside));
	if (peak) {
		const limit = peak.limit;
		const window = limit
			? ` of ${peak.model ?? "the model"}'s ${marks.figure(tokensText(limit.value), limit.origin)} window (${share(peak.tokens, limit.value)})`
			: peak.model
				? ` (${peak.model})`
				: "";
		lines.push(field("Context", `peak ${tokensText(peak.tokens)} tokens${window}`));
	}
	lines.push(field("Why", diagnosisText(cost)));
	lines.push(...errorLines(input.analysis, redactor));
	lines.push(...turnLines(input, marks));
	lines.push(...exportLines(input.exports), ...footer(marks));
	return lines.join("\n");
}

// ── Help and errors ──

export const INSIGHTS_USAGE = [
	"Usage: /insights [--all] [--session <id>] [--html] [--trace]",
	"",
	"  (no flags)      findings and usage for the sessions started in this folder",
	"  --all           every folder's sessions",
	"  --session <id>  one session (a unique id prefix is enough): turns, errors, context peak, cost",
	"  --html          also write that session (else the latest one) as a self-contained HTML page",
	"  --trace         also write it as a Chrome trace (Perfetto UI, chrome://tracing, speedscope)",
	"",
	"Everything is computed on this machine from pi's session files, without a model or the network.",
	"≈ marks an estimate, ≥ a lower bound, ? a figure pi did not record or that could not be measured.",
].join("\n");
