import { type FileHandle, open } from "node:fs/promises";
import {
	BADGED_ORIGINS,
	type CappedJson,
	type CappedText,
	type EventBody,
	EXPORT_RULES,
	type Figure,
	METRIC_SOURCES,
	type MetricId,
	type Origin,
	type SessionAnalysis,
	type SessionOverview,
	type SessionSubagents,
	type SessionTimeline,
	type TraceEvent,
} from "./core.ts";
import { BODY_CAPS, type BodyCaps, eventBody } from "./eventBody.ts";
import { type ByteRange, parseLine, sliceYielder } from "./lines.ts";
import { type Redactor, safeCut } from "./redact.ts";
import { byText } from "./stats.ts";
import { isRecord } from "./totals.ts";
import type { BuiltTrace } from "./trace.ts";
import type { TraceStore } from "./traceStore.ts";

const HTML = EXPORT_RULES.html;
const TITLE_CHARS = 200;

/** Body caps of the HTML export: smaller than the details panel's, no raw entries, no result details. */
const HTML_BODY_CAPS: BodyCaps = {
	...BODY_CAPS,
	prompt: HTML.prompt,
	reply: HTML.reply,
	thinking: HTML.thinking,
	error: HTML.error,
	result: HTML.result,
	text: HTML.reply,
	task: HTML.prompt,
	argString: HTML.args,
};

/** What the HTML export is built from: the same normalized model the panels read. */
export interface HtmlExportInput {
	overview: SessionOverview;
	trace: BuiltTrace;
	/** Bodies are re-read from the pi file by offset, redacted and capped. */
	store: TraceStore;
	timeline: SessionTimeline;
	analysis: SessionAnalysis;
	subagents: SessionSubagents | null;
	/** The user's labels and note, only when they asked to include them. */
	labels: { labels: readonly string[]; note: string | null } | null;
	/** Defaults to the store's redactor. */
	redactor?: Redactor;
	sliceMs?: number;
}

const ORIGIN_TEXT: Readonly<Record<Origin, string>> = {
	recorded: "recorded by pi",
	counted: "counted from the session file",
	host: "reported by the host app",
	approximated: "approximated",
	notRecorded: "not recorded",
	partiallyRecorded: "partially recorded",
	notMeasured: "not measured",
};

const COUNT = new Intl.NumberFormat("en-US");

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

const esc = escapeHtml;

function count(value: number): string {
	return COUNT.format(value);
}

function cost(value: number): string {
	if (value === 0) return "$0";
	if (value < 0.01) return `$${value.toFixed(4)}`;
	return `$${value.toFixed(2)}`;
}

function tokens(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 10_000) return `${Math.round(value / 1000)}k`;
	return count(value);
}

function duration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)} ms`;
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes} min ${Math.round(seconds % 60)} s`;
	return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** UTC, so the file reads the same wherever it is opened or built. */
function utc(ms: number): string {
	return `${new Date(ms).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function badge(origin: Origin): string {
	return BADGED_ORIGINS.includes(origin)
		? ` <span class="badge" data-origin="${origin}">${esc(ORIGIN_TEXT[origin])}</span>`
		: "";
}

/** A figure with its provenance: the origin and source fields in its title, a badge when flagged. */
function figure<T>(
	value: Figure<T>,
	metric: MetricId,
	format: (value: T) => string,
	detail?: string,
): string {
	const sources = METRIC_SOURCES[metric].join(", ");
	const title = [ORIGIN_TEXT[value.origin], detail, `from ${sources}`].filter(Boolean).join(" · ");
	const shown = value.value === null ? "—" : format(value.value);
	return `<span class="figure" title="${esc(title)}">${esc(shown)}</span>${badge(value.origin)}`;
}

function cappedText(text: CappedText | undefined, className = "text"): string {
	if (!text?.text) return "";
	if (!text.cut) return `<pre class="${className}">${esc(text.text)}</pre>`;
	const head = text.text.slice(0, text.cut.at);
	const tail = text.text.slice(text.cut.at);
	const omitted = `… ${count(text.cut.chars)} characters (${count(text.cut.lines)} lines) left out of ${count(text.chars)} …`;
	return `<pre class="${className}">${esc(head)}<span class="cut">${esc(omitted)}</span>${esc(tail)}</pre>`;
}

function cappedJson(value: CappedJson | undefined): string {
	if (!value) return "";
	const text = JSON.stringify(value.value, null, 2) ?? "";
	const at = text.length > HTML.args ? safeCut(text, HTML.args) : text.length;
	const kept = text.slice(0, at);
	const cut =
		at < text.length
			? `<span class="cut">${esc(`… ${count(text.length - at)} more characters`)}</span>`
			: "";
	const cuts =
		value.cuts.length > 0
			? `<p class="note">${esc(`${value.cuts.length} value(s) cut to the cap.`)}</p>`
			: "";
	return `<pre class="json">${esc(kept)}${cut}</pre>${cuts}`;
}

function section(title: string, body: string): string {
	return `<div class="part"><h4>${esc(title)}</h4>${body}</div>`;
}

function bodyHtml(event: TraceEvent, body: EventBody | null): string {
	if (!body) return `<p class="note">The body could not be re-read from the session file.</p>`;
	const parts: string[] = [];
	if (body.prompt) parts.push(section("Prompt", cappedText(body.prompt)));
	if (body.images)
		parts.push(`<p class="note">${esc(`${body.images} image(s) not exported.`)}</p>`);
	if (body.text) parts.push(section("Content", cappedText(body.text)));
	if (body.task) parts.push(section("Task", cappedText(body.task)));
	if (body.input && event.kind !== "subagent") parts.push(section("Input", cappedJson(body.input)));
	if (body.result) parts.push(section("Result", cappedText(body.result, "text result")));
	if (body.resultImages)
		parts.push(`<p class="note">${esc(`${body.resultImages} image(s) not exported.`)}</p>`);
	if (body.reply) parts.push(section("Reply", cappedText(body.reply)));
	if (body.thinking) parts.push(section("Thinking", cappedText(body.thinking, "text thinking")));
	if (body.encryptedThinking)
		parts.push(
			`<p class="note">${esc(`${body.encryptedThinking} thinking block(s) encrypted by the provider.`)}</p>`,
		);
	if (body.error && event.kind === "llm")
		parts.push(section("Error", cappedText(body.error, "text error")));
	return parts.join("");
}

const KIND_TEXT: Readonly<Record<TraceEvent["kind"], string>> = {
	turn: "Turn",
	llm: "Model call",
	tool: "Tool",
	subagent: "Subagent",
	mark: "Marker",
};

function summaryLine(event: TraceEvent, start: number): string {
	const at = `+${duration(Math.max(0, event.t0 - start))}`;
	const span = event.t1 > event.t0 ? duration(event.t1 - event.t0) : "";
	const timing = event.timing === "recorded" ? "" : ` (${event.timing})`;
	let name: string = KIND_TEXT[event.kind];
	let extra = "";
	switch (event.kind) {
		case "turn":
			name = `Turn ${event.n}`;
			if (event.trigger !== "prompt")
				extra = event.trigger === "background" ? "background done" : "subagent done";
			break;
		case "llm":
			name = event.model ?? "Model call";
			extra = `${tokens(event.tokens.total)} tokens${event.cost > 0 ? ` · ${cost(event.cost)}` : ""}`;
			break;
		case "tool":
			name = event.tool;
			if (event.exit && event.exit !== "0")
				extra = /^\d+$/.test(event.exit) ? `exit ${event.exit}` : event.exit;
			if (event.missing) extra = "no result";
			break;
		case "subagent":
			name = `Subagent${event.role ? ` · ${event.role}` : ""}`;
			extra = event.status ?? "";
			break;
		case "mark":
			name = event.detail ? `${event.mark} · ${event.detail}` : event.mark;
			break;
	}
	return [
		`<span class="kind kind-${event.kind}">${esc(KIND_TEXT[event.kind])}</span>`,
		`<span class="name">${esc(name)}</span>`,
		event.label ? `<span class="label">${esc(event.label)}</span>` : "",
		extra ? `<span class="extra">${esc(extra)}</span>` : "",
		event.error ? `<span class="failed">failed</span>` : "",
		`<span class="time" title="${esc(`${utc(event.t0)}${timing}`)}">${esc(span ? `${at} · ${span}` : at)}</span>`,
	].join("");
}

interface Node {
	event: TraceEvent;
	index: number;
	children: Node[];
}

function treeOf(events: readonly TraceEvent[]): Node[] {
	const byId = new Map<string, Node>();
	const roots: Node[] = [];
	events.forEach((event, index) => {
		const node: Node = { event, index, children: [] };
		byId.set(event.id, node);
		const parent = event.parent ? byId.get(event.parent) : undefined;
		if (parent) parent.children.push(node);
		else roots.push(node);
	});
	return roots;
}

function renderNode(
	node: Node,
	bodies: ReadonlyMap<string, EventBody | null>,
	start: number,
	out: string[],
): void {
	const { event } = node;
	const open = event.kind === "turn" ? " open" : "";
	const failed = event.error ? " failed" : "";
	out.push(
		`<details id="ev-${node.index}" class="event ${event.kind}${failed}"${open}><summary>${summaryLine(event, start)}</summary><div class="body">`,
	);
	out.push(bodyHtml(event, bodies.get(event.id) ?? null));
	if (node.children.length > 0) {
		out.push(`<div class="children">`);
		for (const child of node.children) renderNode(child, bodies, start, out);
		out.push(`</div>`);
	}
	out.push(`</div></details>`);
}

function headerHtml(input: HtmlExportInput, title: string, redactor: Redactor): string {
	const { overview: session, labels } = input;
	const where = redactor.redact(
		[session.projectName, session.workspaceName].filter(Boolean).join(" › "),
	);
	const total = session.tokens.value;
	const outside = session.subagentsOutside.value;
	const rows: [string, string][] = [
		["Start", figure(session.start, "start", utc)],
		["Wall time", figure(session.wallMs, "wallTime", duration)],
		["Active time", figure(session.activeMs, "activeTime", duration)],
		[
			"Tokens",
			figure(
				session.tokens,
				"tokens",
				(value) => count(value.total),
				total
					? `input ${count(total.input)}, output ${count(total.output)}, cache read ${count(total.cacheRead)}, cache write ${count(total.cacheWrite)}`
					: undefined,
			),
		],
		["Cost", figure(session.cost, "cost", cost)],
		["Tool calls", figure(session.toolCalls, "toolCalls", count)],
		["Failed tool calls", figure(session.toolErrors, "toolErrors", count)],
		["Subagents", figure(session.subagents, "subagents", count)],
		["Outcome", esc(session.outcome ?? "—")],
	];
	if (outside && (outside.cost > 0 || outside.tokens > 0))
		rows.push([
			"Subagents outside pi's total",
			figure(session.subagentsOutside, "subagentsOutside", (value) =>
				value.cost > 0 ? `+${cost(value.cost)}` : `+${count(value.tokens)} tokens`,
			),
		]);
	const figures = rows
		.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`)
		.join("");
	const models =
		session.models.length > 0
			? `<p class="models">Models: ${session.models.map((model) => `<code>${esc(redactor.redact(model))}</code>`).join(" ")}</p>`
			: "";
	const userData = labels
		? `<div class="labels">${labels.labels.map((label) => `<span class="chip">${esc(redactor.redact(label))}</span>`).join("")}${
				labels.note ? `<p class="note-text">${esc(redactor.clean(labels.note))}</p>` : ""
			}</div>`
		: "";
	return `<header><h1>${esc(title)}</h1><p class="where">${esc(where || "Outside every project")}</p>${userData}<dl class="figures">${figures}</dl>${models}</header>`;
}

function turnsHtml(timeline: SessionTimeline, trace: BuiltTrace): string {
	if (timeline.turns.length === 0) return `<p class="note">No turns.</p>`;
	const labels = new Map(trace.events.map((event, index) => [event.id, { event, index }]));
	const rows = timeline.turns
		.map((turn) => {
			const found = labels.get(turn.id);
			const label = found?.event.label ?? "";
			const link = found ? `<a href="#ev-${found.index}">${turn.n}</a>` : String(turn.n);
			return `<tr><td>${link}</td><td class="prompt">${esc(label)}</td><td>${esc(utc(turn.t0))}</td><td>${figure(turn.duration, "turnDuration", duration)}</td><td>${figure(turn.llmCalls, "llmCalls", count)}</td><td>${figure(turn.toolCalls, "toolCalls", count)}</td><td>${figure(turn.errors, "errors", count)}</td><td>${figure(turn.tokens, "tokens", (value) => count(value.total))}</td><td>${figure(turn.cost, "cost", cost)}</td></tr>`;
		})
		.join("");
	return `<table><thead><tr><th>#</th><th>Prompt</th><th>Start</th><th>Duration</th><th>Model calls</th><th>Tool calls</th><th>Errors</th><th>Tokens</th><th>Cost</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function errorsHtml(analysis: SessionAnalysis): string {
	if (analysis.chains.length === 0) return `<p class="note">No failed calls.</p>`;
	const outcomes = new Map<string, number>();
	for (const chain of analysis.chains)
		outcomes.set(chain.outcome, (outcomes.get(chain.outcome) ?? 0) + 1);
	const summary = [...outcomes.entries()]
		.sort((a, b) => b[1] - a[1] || byText(a[0], b[0]))
		.map(([outcome, n]) => `${outcome} ${n}`)
		.join(" · ");
	const chains = analysis.chains
		.map(
			(chain) =>
				`<tr><td>${esc(chain.kind)}</td><td>${esc(chain.name ?? "—")}</td><td>${esc(chain.outcome)}</td><td>${count(chain.attempts.length)}</td><td>${figure(chain.recoveredIn, "recovery", duration)}</td><td class="line">${esc(chain.line)}</td></tr>`,
		)
		.join("");
	const clusters = analysis.clusters
		.map(
			(cluster) =>
				`<li><code>${esc(cluster.sample)}</code> <span class="extra">×${count(cluster.ids.length)}</span></li>`,
		)
		.join("");
	return `<p class="note">Recovery chains are a heuristic: a retry is the next call of the same tool on the same target. ${esc(summary)}</p><table><thead><tr><th>Kind</th><th>Tool or model</th><th>Outcome</th><th>Attempts</th><th>Recovered in</th><th>First error</th></tr></thead><tbody>${chains}</tbody></table>${
		clusters ? `<h3>Error clusters</h3><ul class="clusters">${clusters}</ul>` : ""
	}`;
}

function subagentsHtml(subagents: SessionSubagents | null): string {
	if (!subagents || subagents.runs.length === 0) return `<p class="note">No subagents.</p>`;
	const rows = subagents.runs
		.map(
			(run) =>
				`<tr><td>${esc(run.role ?? "—")}</td><td class="prompt">${esc(run.title)}</td><td>${esc(run.status ?? "—")}</td><td>${run.background ? "background" : "waited for"}</td><td>${figure(run.duration, "subagentRun", duration)}</td><td>${figure(run.tokens, "subagentRun", count)}</td><td>${figure(run.cost, "subagentRun", cost)}</td><td>${esc(run.transcript)}</td></tr>`,
		)
		.join("");
	const { overview } = subagents;
	return `<p class="note">${esc(`${subagents.runs.length} run(s) in ${subagents.waves.length} wave(s), at most ${overview.maxParallel} at once; ${overview.failed} failed or aborted.`)}</p><table><thead><tr><th>Role</th><th>Task</th><th>Status</th><th>Parent</th><th>Duration</th><th>Tokens</th><th>Cost</th><th>Transcript</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const STYLE = `
:root{color-scheme:light dark;--bg:#ffffff;--fg:#1f2328;--muted:#59636e;--subtle:#818b98;--border:#d1d9e0;--panel:#f6f8fa;--accent:#0969da;--error:#cf222e;--warn:#9a6700;--ok:#1a7f37;--chip:#ddf4ff}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--subtle:#6e7681;--border:#3d444d;--panel:#151b23;--accent:#4493f8;--error:#f85149;--warn:#d29922;--ok:#3fb950;--chip:#132339}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 8px;border-bottom:1px solid var(--border);padding-bottom:4px}h3{font-size:15px;margin:16px 0 6px}h4{font-size:12px;margin:8px 0 2px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.where,.models,.note{color:var(--muted);margin:4px 0}
.notice{border:1px solid var(--border);background:var(--panel);border-radius:6px;padding:8px 12px;color:var(--muted)}
nav{display:flex;gap:16px;margin:16px 0}nav a,a{color:var(--accent)}
code,pre,.time,.figure{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
code{font-size:12px;background:var(--panel);border:1px solid var(--border);border-radius:4px;padding:0 4px}
pre{white-space:pre-wrap;word-break:break-word;font-size:12px;background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:8px;margin:2px 0 6px;max-height:480px;overflow:auto}
pre.error{border-color:var(--error)}
.cut{display:block;color:var(--warn);font-style:italic;margin:4px 0}
.figures{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px 16px;margin:12px 0}
.figures dt{font-size:12px;color:var(--subtle)}.figures dd{margin:0}
.badge{display:inline-block;font-size:11px;border:1px dashed var(--warn);color:var(--warn);border-radius:4px;padding:0 4px;margin-left:4px}
.labels{margin:8px 0}.chip{display:inline-block;background:var(--chip);border:1px solid var(--border);border-radius:999px;padding:0 8px;margin-right:4px;font-size:12px}
.note-text{white-space:pre-wrap;margin:6px 0}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid var(--border);padding:4px 6px;text-align:left;vertical-align:top}th{color:var(--muted);font-weight:600}
td.prompt,td.line{max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.controls{display:flex;gap:8px;margin:8px 0}
button{font:inherit;font-size:12px;color:var(--fg);background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:2px 10px;cursor:pointer}
button:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
details.event{border-left:2px solid var(--border);margin:2px 0 2px 0;padding-left:8px}
details.event.failed{border-left-color:var(--error)}
details.turn{border-left-color:var(--accent);margin-top:10px}
summary{cursor:pointer;display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;padding:2px 0}
summary .kind{font-size:11px;color:var(--subtle);text-transform:uppercase;letter-spacing:.04em;min-width:76px}
summary .name{font-weight:600}summary .label{color:var(--muted);flex:1 1 200px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
summary .extra{color:var(--subtle);font-size:12px}summary .failed{color:var(--error);font-size:12px;font-weight:600}summary .time{color:var(--subtle);font-size:12px;margin-left:auto}
.body{padding:2px 0 4px 8px}.children{margin-top:4px}
.clusters{padding-left:18px}
footer{margin-top:40px;color:var(--subtle);font-size:12px}
`;

const SCRIPT = `document.addEventListener("click",function(e){var b=e.target.closest("[data-open]");if(!b)return;var open=b.getAttribute("data-open")==="all";document.querySelectorAll("#trace details").forEach(function(d){d.open=open||d.classList.contains("turn")&&b.getAttribute("data-open")==="turns"})});`;

/** An export's name for the session: its title, else its first prompt's excerpt quoted, else "Untitled session". */
export function exportTitle(overview: SessionOverview, redactor: Redactor): string {
	if (overview.title) return redactor.label(overview.title, TITLE_CHARS);
	if (overview.firstPrompt) return `“${redactor.label(overview.firstPrompt, TITLE_CHARS)}”`;
	return "Untitled session";
}

async function readAt(
	handle: FileHandle,
	range: ByteRange,
): Promise<Record<string, unknown> | null> {
	const bytes = new Uint8Array(range.length);
	let at = 0;
	while (at < range.length) {
		const { bytesRead } = await handle.read(bytes, at, range.length - at, range.offset + at);
		if (bytesRead === 0) break;
		at += bytesRead;
	}
	const entry = parseLine(bytes.subarray(0, at));
	return isRecord(entry) ? entry : null;
}

function sameEntry(entry: Record<string, unknown> | null, id: string, range: ByteRange): boolean {
	if (!entry) return false;
	return typeof entry.id === "string" ? entry.id === id : id === `@${range.offset}`;
}

/**
 * Reads every event's body for the export (redacted, capped, no raw entries) through one file handle,
 * yielding as it goes; an entry that no longer matches its skeleton falls back to the store's verified read.
 */
async function readBodies(input: HtmlExportInput): Promise<Map<string, EventBody | null>> {
	const { trace, store } = input;
	const redactor = input.redactor ?? store.redaction;
	const yielder = sliceYielder(input.sliceMs ?? 8);
	const bodies = new Map<string, EventBody | null>();
	const options = { caps: HTML_BODY_CAPS, raw: false };
	const handle = await open(trace.file, "r");
	try {
		for (const event of trace.events) {
			const source = trace.sources.get(event.id);
			const entry = source ? await readAt(handle, source.range) : null;
			const result = source?.result ? await readAt(handle, source.result.range) : null;
			if (
				source &&
				entry &&
				sameEntry(entry, source.entryId, source.range) &&
				(!source.result || sameEntry(result, source.result.entryId, source.result.range))
			) {
				bodies.set(event.id, eventBody(redactor, event, source, { entry, result }, [], options));
			} else {
				const read = await store.read(trace.file, event.id);
				bodies.set(
					event.id,
					read ? eventBody(redactor, read.event, read.source, read.parsed, [], options) : null,
				);
			}
			if (yielder.due()) await yielder.pause();
		}
	} finally {
		await handle.close();
	}
	return bodies;
}

/**
 * The self-contained HTML export of one session: inline CSS (light and dark through CSS variables,
 * system fonts), a few lines of inline script for expanding and collapsing, no network reference
 * (a `default-src 'none'` policy), built from the summary, the turn list, the full trace with every
 * body redacted and capped, and the errors and subagents summaries. Deterministic for one file revision.
 */
export async function renderSessionHtml(input: HtmlExportInput): Promise<string> {
	const { overview, trace } = input;
	const redactor = input.redactor ?? input.store.redaction;
	const title = exportTitle(overview, redactor);
	const bodies = await readBodies(input);
	const start = trace.meta.start ?? 0;
	const out: string[] = [];
	const yielder = sliceYielder(input.sliceMs ?? 8);
	for (const node of treeOf(trace.events)) {
		renderNode(node, bodies, start, out);
		if (yielder.due()) await yielder.pause();
	}
	const off =
		trace.meta.offBranch > 0
			? `<p class="note">${esc(`${trace.meta.offBranch} entries on abandoned branches are not shown.`)}</p>`
			: "";
	return [
		`<!doctype html>`,
		`<html lang="en"><head><meta charset="utf-8">`,
		`<meta name="viewport" content="width=device-width, initial-scale=1">`,
		`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">`,
		`<meta name="generator" content="session insights">`,
		`<title>${esc(title)}</title><style>${STYLE}</style></head><body><main>`,
		headerHtml(input, title, redactor),
		`<p class="notice">Secrets were masked with best-effort rules (key shapes, tokens, passwords, credentials in URLs, private keys, emails, the home folder). Review the file before you share it.</p>`,
		`<nav><a href="#turns">Turns</a><a href="#trace">Trace</a><a href="#errors">Errors</a><a href="#subagents">Subagents</a></nav>`,
		`<section id="turns"><h2>Turns</h2>${turnsHtml(input.timeline, trace)}</section>`,
		`<section id="trace"><h2>Trace</h2>${off}<div class="controls"><button type="button" data-open="all">Expand all</button><button type="button" data-open="turns">Turns only</button><button type="button" data-open="none">Collapse all</button></div>${out.join("")}</section>`,
		`<section id="errors"><h2>Errors</h2>${errorsHtml(input.analysis)}</section>`,
		`<section id="subagents"><h2>Subagents</h2>${subagentsHtml(input.subagents)}</section>`,
		`<footer>Exported by session insights. Figures carry their origin in their tooltip; flagged ones say so. Bodies are cut to ${count(HTML.result)} characters; images are not exported. Session ${esc(trace.sessionId)}, revision ${esc(trace.meta.revision)}.</footer>`,
		`</main><script>${SCRIPT}</script></body></html>`,
		"",
	].join("\n");
}

/** A tag of a page: its lower-cased name and attributes (names lower-cased, values decoded, `""` when bare). */
interface PageTag {
	name: string;
	attributes: [string, string][];
}

/** A page read the way the check needs it: what a reader sees, and the markup a browser could load from. */
export interface PageParts {
	/** Each text node and attribute value on its own, entities decoded. */
	texts: string[];
	tags: PageTag[];
	/** The raw content of `<style>` and `<script>` blocks. */
	blocks: string[];
}

const TAG = /<!--[\s\S]*?-->|<\/?([A-Za-z][A-Za-z0-9-]*)\b([^>]*)>/g;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const RAW_TEXT: ReadonlySet<string> = new Set(["style", "script"]);

/**
 * Splits a page into its text nodes, tags and raw blocks. Text is escaped wherever the page puts it, so
 * every `<` starts a tag of the template: a body never reads as markup, and a body's end never joins the
 * markup after it.
 */
export function pageParts(html: string): PageParts {
	const parts: PageParts = { texts: [], tags: [], blocks: [] };
	const tags = new RegExp(TAG.source, "g");
	let at = 0;
	const text = (end: number) => {
		if (end > at) parts.texts.push(decodeEntities(html.slice(at, end)));
	};
	for (let match = tags.exec(html); match; match = tags.exec(html)) {
		text(match.index);
		const [tag, rawName, body = ""] = match;
		at = match.index + tag.length;
		if (!rawName) continue;
		const name = rawName.toLowerCase();
		const attributes: [string, string][] = [];
		if (body.trim())
			for (const [, attribute = "", ...values] of body.matchAll(ATTRIBUTE)) {
				const value = decodeEntities(values.find((item) => item !== undefined) ?? "");
				attributes.push([attribute.toLowerCase(), value]);
				if (value) parts.texts.push(value);
			}
		parts.tags.push({ name, attributes });
		if (tag.startsWith("</") || !RAW_TEXT.has(name)) continue;
		const close = html.slice(at).search(new RegExp(`</${name}\\b`, "i"));
		const end = close < 0 ? html.length : at + close;
		parts.blocks.push(html.slice(at, end));
		at = end;
		tags.lastIndex = end;
	}
	text(html.length);
	return parts;
}

const NETWORK_URL = /^\s*(?:(?:https?|wss?|ftp):|\/\/)/i;
const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
	"src",
	"href",
	"srcset",
	"action",
	"formaction",
	"poster",
	"data",
	"background",
	"xlink:href",
]);
const CSS_URL = /url\(\s*["']?\s*(?:https?:|\/\/)/i;
const CSS_IMPORT = /@import\b/i;

/**
 * The kinds of resource references a self-contained page must not carry, looked for in its markup only
 * (tags and `<style>` / `<script>` blocks; a body that quotes CSS or HTML is text): a `src` / `href` (or
 * another URL attribute) to a network scheme, `<link>`, or CSS `url()` to the network or `@import`.
 */
export function networkReferences(html: string | PageParts): string[] {
	const parts = typeof html === "string" ? pageParts(html) : html;
	const found = new Set<string>();
	for (const block of parts.blocks) {
		if (CSS_URL.test(block)) found.add("url");
		if (CSS_IMPORT.test(block)) found.add("import");
	}
	for (const { name, attributes } of parts.tags) {
		if (name === "link") found.add("link");
		for (const [attribute, value] of attributes) {
			if (URL_ATTRIBUTES.has(attribute) && NETWORK_URL.test(value))
				found.add(attribute === "src" || attribute === "href" ? attribute : "url");
			if (attribute === "style" && (CSS_URL.test(value) || CSS_IMPORT.test(value)))
				found.add("url");
		}
	}
	return [...found];
}

/** Text as a reader sees it (the entities the page writes decoded). */
function decodeEntities(html: string): string {
	return html
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");
}
