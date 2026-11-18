import {
	type FileCell,
	type FileColumn,
	type FileColumnsKind,
	type FileDetail,
	type FileDetailParams,
	type FileDiff,
	type FileOp,
	type FileReceipt,
	type FileReceiptSum,
	type FileRow,
	type FileTouch,
	REWORK_CHANGES,
	type SessionFiles,
	type ToolEvent,
} from "./core.ts";
import { parseSessionParams } from "./list.ts";
import { analysePlan, turnsOf } from "./plan.ts";
import { isRecord } from "./totals.ts";
import { type BuiltTrace, succeeded } from "./trace.ts";
import type { TraceStore } from "./traceStore.ts";

/** Few enough turns that the matrix splits them into plan steps. */
const STEP_COLUMNS_TURNS = 3;
const MAX_ROWS = 300;
const MAX_DIFFS = 40;
const DIFF_CHARS = 6_000;
const PATH_MAX = 1_000;

/** A change set the embedder recorded for a run of the session (ThinkRail: a turn receipt). */
export interface ChangeReceipt {
	startedAt: number;
	settledAt: number;
	changes: readonly { path: string; status: string; added?: number; removed?: number }[];
}

export function parseFileDetailParams(value: unknown): FileDetailParams {
	const method = "file.detail";
	const { sessionId } = parseSessionParams(value, method);
	const path = isRecord(value) ? value.path : undefined;
	if (typeof path !== "string" || path.length === 0 || path.length > PATH_MAX)
		throw new Error(`Invalid ${method} params`);
	return { sessionId, path };
}

interface Touch {
	event: ToolEvent;
	path: string;
	inside: boolean;
	op: FileOp;
	added: number;
	removed: number;
	line: number | null;
	/** `null` for a call without a recorded result: it never ran, so the matrix does not count it. */
	column: number | null;
}

interface Layout {
	kind: FileColumnsKind;
	columns: FileColumn[];
	touches: Touch[];
}

function opOf(tool: string): FileOp | null {
	return tool === "read" || tool === "edit" || tool === "write" ? tool : null;
}

function layout(trace: BuiltTrace): Layout {
	const { events } = trace;
	const turnOf = turnsOf(events);
	const turns = new Map<string, { n: number; label: string }>();
	for (const event of events) if (event.kind === "turn") turns.set(event.id, event);
	const analysis = analysePlan(trace);
	const steps = analysis.plan?.steps ?? [];
	const stepNumber = new Map(steps.map((step, at) => [step.id, at + 1]));
	const stepTitle = new Map(steps.map((step) => [step.id, step.title]));
	const raw: Omit<Touch, "column">[] = [];
	for (const event of events) {
		if (event.kind !== "tool") continue;
		const op = opOf(event.tool);
		const file = trace.facts.get(event.id)?.call?.file;
		if (!op || !file) continue;
		const edit = trace.facts.get(event.id)?.result?.edit ?? null;
		const changed = succeeded(event);
		raw.push({
			event,
			path: file.path,
			inside: file.inside,
			op,
			added: !changed ? 0 : op === "write" ? (file.lines ?? 0) : (edit?.added ?? 0),
			removed: !changed || op !== "edit" ? 0 : (edit?.removed ?? 0),
			line: op === "edit" ? (edit?.line ?? null) : null,
		});
	}
	const touchedTurns = new Set(
		raw.filter((touch) => !touch.event.missing).map((touch) => turnOf.get(touch.event.id) ?? null),
	);
	const kind: FileColumnsKind =
		touchedTurns.size <= STEP_COLUMNS_TURNS && steps.length > 0 ? "steps" : "turns";
	const columns: FileColumn[] = [];
	const columnOf = new Map<string, number>();
	const touches: Touch[] = raw.map((touch) => {
		if (touch.event.missing) return { ...touch, column: null };
		const turnId = turnOf.get(touch.event.id) ?? null;
		const stepId = kind === "steps" ? (analysis.stepOf.get(touch.event.id) ?? null) : null;
		const key = `${turnId}\u0000${stepId}`;
		let column = columnOf.get(key);
		if (column === undefined) {
			const turn = turnId ? turns.get(turnId) : undefined;
			column = columns.length;
			columnOf.set(key, column);
			columns.push({
				turnId,
				turnN: turn?.n ?? null,
				stepId,
				stepN: stepId ? (stepNumber.get(stepId) ?? null) : null,
				title:
					kind === "steps" ? (stepId ? (stepTitle.get(stepId) ?? "") : "") : (turn?.label ?? ""),
				t0: touch.event.t0,
			});
		}
		return { ...touch, column };
	});
	const order = columns
		.map((column, at) => ({ column, at }))
		.sort(
			(a, b) =>
				(a.column.turnN ?? 0) - (b.column.turnN ?? 0) || a.column.t0 - b.column.t0 || a.at - b.at,
		);
	const remap = new Map(order.map(({ at }, next) => [at, next]));
	for (const touch of touches)
		if (touch.column !== null) touch.column = remap.get(touch.column) ?? touch.column;
	return { kind, columns: order.map(({ column }) => column), touches };
}

function receiptSums(receipts: readonly ChangeReceipt[]): Map<string, FileReceiptSum> {
	const sums = new Map<string, FileReceiptSum>();
	for (const receipt of receipts)
		for (const change of receipt.changes) {
			const sum = sums.get(change.path) ?? { added: 0, removed: 0, runs: 0 };
			sum.added += change.added ?? 0;
			sum.removed += change.removed ?? 0;
			sum.runs += 1;
			sums.set(change.path, sum);
		}
	return sums;
}

function rowsOf(touches: readonly Touch[], receipts: readonly ChangeReceipt[]): FileRow[] {
	const sums = receiptSums(receipts);
	const rows = new Map<string, FileRow & { cellsAt: Map<number, number[]> }>();
	for (const touch of touches) {
		if (touch.column === null) continue;
		let row = rows.get(touch.path);
		if (!row) {
			row = {
				path: touch.path,
				inside: touch.inside,
				reads: 0,
				edits: 0,
				writes: 0,
				failed: 0,
				added: 0,
				removed: 0,
				rework: false,
				cells: [],
				receipt: touch.inside ? (sums.get(touch.path) ?? null) : null,
				cellsAt: new Map(),
			};
			rows.set(touch.path, row);
		}
		const cell = row.cellsAt.get(touch.column) ?? [touch.column, 0, 0, 0, 0];
		row.cellsAt.set(touch.column, cell);
		const failed = touch.event.error === true;
		if (touch.op === "read") {
			if (!failed) {
				row.reads += 1;
				cell[1] = (cell[1] ?? 0) + 1;
			}
		} else if (failed) {
			row.failed += 1;
			cell[4] = (cell[4] ?? 0) + 1;
		} else if (touch.op === "edit") {
			row.edits += 1;
			cell[2] = (cell[2] ?? 0) + 1;
		} else {
			row.writes += 1;
			cell[3] = (cell[3] ?? 0) + 1;
		}
		row.added += touch.added;
		row.removed += touch.removed;
	}
	return [...rows.values()]
		.map(({ cellsAt, ...row }) => ({
			...row,
			rework: row.edits + row.writes >= REWORK_CHANGES,
			cells: [...cellsAt.values()]
				.sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0))
				.map((cell) => cell as unknown as FileCell),
		}))
		.sort(
			(a, b) =>
				b.edits + b.writes - (a.edits + a.writes) ||
				b.failed - a.failed ||
				b.reads - a.reads ||
				(a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
		);
}

/**
 * The session's files × turns (or plan steps inside few turns): reads, edits and writes from the tool
 * calls themselves, failed edits, rework (`REWORK_CHANGES`), line counts from the edit patches and
 * written content, and the embedder's receipts beside them when it has any. A call without a recorded
 * result never ran and counts nowhere. Analytics only.
 */
export function buildSessionFiles(
	trace: BuiltTrace,
	receipts: readonly ChangeReceipt[] = [],
): SessionFiles {
	const { kind, columns, touches } = layout(trace);
	const rows = rowsOf(touches, receipts);
	let added = 0;
	let removed = 0;
	let failed = 0;
	let start: number | null = null;
	let end: number | null = null;
	for (const event of trace.events)
		if (event.kind === "llm" || event.kind === "tool") {
			start = start === null ? event.t0 : Math.min(start, event.t0);
			end = end === null ? event.t1 : Math.max(end, event.t1);
		}
	for (const row of rows) {
		added += row.added;
		removed += row.removed;
		failed += row.failed;
	}
	return {
		revision: trace.meta.revision,
		columns: kind,
		cols: columns,
		rows: rows.slice(0, MAX_ROWS),
		hidden: Math.max(0, rows.length - MAX_ROWS),
		totals: {
			files: rows.length,
			changed: rows.filter((row) => row.edits + row.writes > 0).length,
			readOnly: rows.filter((row) => row.edits + row.writes === 0 && row.reads > 0).length,
			rework: rows.filter((row) => row.rework).length,
			failed,
			added,
			removed,
		},
		receipts: receipts.length > 0,
		start,
		end,
	};
}

function diffText(
	parsed: { entry: Record<string, unknown>; result: Record<string, unknown> | null },
	callIndex: number | undefined,
	op: "edit" | "write",
): string | null {
	if (op === "write") {
		const message = isRecord(parsed.entry.message) ? parsed.entry.message : {};
		const calls = (Array.isArray(message.content) ? message.content : []).filter(
			(block) => isRecord(block) && block.type === "toolCall",
		);
		const call = calls[callIndex ?? 0];
		const args = isRecord(call) && isRecord(call.arguments) ? call.arguments : {};
		return typeof args.content === "string" ? args.content : null;
	}
	const result = parsed.result && isRecord(parsed.result.message) ? parsed.result.message : null;
	const details = result && isRecord(result.details) ? result.details : null;
	if (!details) return null;
	if (typeof details.patch === "string" && details.patch) return details.patch;
	return typeof details.diff === "string" ? details.diff : null;
}

/**
 * One file's touches over time (a call without a result listed as `missing`, outside every column) and
 * the diffs its successful edits and writes recorded, re-read by offset.
 */
export async function buildFileDetail(
	store: TraceStore,
	file: string,
	trace: BuiltTrace,
	path: string,
	receipts: readonly ChangeReceipt[] = [],
): Promise<FileDetail | null> {
	const { touches } = layout(trace);
	const own = touches.filter((touch) => touch.path === path);
	const row = rowsOf(own, receipts)[0];
	if (!row) return null;
	const changes = own.filter((touch) => touch.op !== "read" && succeeded(touch.event));
	const diffs: FileDiff[] = [];
	for (const touch of changes.slice(-MAX_DIFFS)) {
		const read = await store.read(file, touch.event.id);
		if (!read) continue;
		const op = touch.op === "write" ? "write" : "edit";
		const text = diffText(read.parsed, read.source.callIndex, op);
		if (text === null) continue;
		diffs.push({
			eventId: touch.event.id,
			t: touch.event.t0,
			op,
			failed: false,
			text: store.redaction.cap(text, DIFF_CHARS),
			line: touch.line,
		});
	}
	const fileReceipts: FileReceipt[] = [];
	if (row.inside)
		for (const receipt of receipts)
			for (const change of receipt.changes)
				if (change.path === path)
					fileReceipts.push({
						startedAt: receipt.startedAt,
						settledAt: receipt.settledAt,
						status: change.status,
						added: change.added ?? null,
						removed: change.removed ?? null,
					});
	const touched: FileTouch[] = own.map((touch) => ({
		eventId: touch.event.id,
		t: touch.event.t0,
		op: touch.op,
		failed: touch.event.error === true,
		...(touch.event.missing ? { missing: true as const } : {}),
		added: touch.added,
		removed: touch.removed,
		column: touch.column,
		line: touch.line,
	}));
	return {
		row,
		touches: touched,
		diffs,
		moreDiffs: Math.max(0, changes.length - MAX_DIFFS),
		receipts: fileReceipts.sort((a, b) => a.startedAt - b.startedAt),
	};
}
