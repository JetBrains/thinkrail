import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { link, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { type ChromeTraceInput, chromeTrace } from "./chromeTrace.ts";
import {
	EXPORT_RULES,
	type ExportCheckFinding,
	type ExportCut,
	type ExportFixtureParams,
	type ExportKind,
	type ExportNote,
	type ExportParams,
	type ExportResult,
	SESSION_INSIGHTS_API_VERSION,
} from "./core.ts";
import { networkReferences, pageParts } from "./exportHtml.ts";
import { cutSessionFile, fixtureName, fixturePath, textOf } from "./fixture.ts";
import { scanFile, sliceYielder } from "./lines.ts";
import { REDACTED, type Redactor, type SecretKind, secretChecker, secretUnder } from "./redact.ts";
import { isRecord } from "./totals.ts";
import type { BuiltTrace } from "./trace.ts";

const ID_CHARS = 200;
const EVENT_ID_CHARS = 400;

function validId(value: unknown, max = ID_CHARS): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= max;
}

/** `{ sessionId, workspaceId, includeLabels? }` of `export.html` and `export.trace`. */
export function parseExportParams(value: unknown, method: string): ExportParams {
	if (isRecord(value)) {
		const { sessionId, workspaceId, includeLabels } = value;
		if (
			validId(sessionId) &&
			validId(workspaceId) &&
			(includeLabels === undefined || typeof includeLabels === "boolean")
		)
			return { sessionId, workspaceId, includeLabels: includeLabels === true };
	}
	throw new Error(`Invalid ${method} params`);
}

function parseCut(value: unknown): ExportCut | null {
	if (!isRecord(value)) return null;
	if (
		value.kind === "turn" &&
		typeof value.turn === "number" &&
		Number.isSafeInteger(value.turn) &&
		value.turn > 0
	)
		return { kind: "turn", turn: value.turn };
	if (value.kind === "event" && validId(value.eventId, EVENT_ID_CHARS))
		return { kind: "event", eventId: value.eventId };
	return null;
}

/** `export.fixture` adds an optional `cut` and `name` (letters, digits and dashes). */
export function parseExportFixtureParams(value: unknown, method: string): ExportFixtureParams {
	const base = parseExportParams(value, method);
	const fail = () => new Error(`Invalid ${method} params`);
	if (!isRecord(value)) throw fail();
	const out: ExportFixtureParams = { ...base };
	if (value.cut !== undefined) {
		const cut = parseCut(value.cut);
		if (!cut) throw fail();
		out.cut = cut;
	}
	if (value.name !== undefined) {
		if (
			typeof value.name !== "string" ||
			value.name.length > EXPORT_RULES.nameChars ||
			(value.name !== "" && fixtureName(value.name) === "")
		)
			throw fail();
		if (value.name) out.name = value.name;
	}
	return out;
}

/** The workspace's artifacts folder as the host hands it over: absolute, and workspace-relative with a trailing `/`. */
export interface ExportTarget {
	dir: string;
	relative: string;
}

/**
 * How the check reads a file: a page (each text node and attribute value, entities decoded; no network
 * reference in its markup), JSON or JSONL (each key and string value, and no unmasked value under a
 * secret-named key), or text.
 */
export type ExportCheck = "html" | "json" | "jsonl" | "text";

export interface ExportFile {
	/** Inside the export's folder, `/`-separated; ignored for a single-file export. */
	path: string;
	content: string | Uint8Array;
	check: ExportCheck;
}

export interface ExportOutput {
	kind: ExportKind;
	/** The file's or folder's path under `<artifacts>/session-insights/`; its last segment is made unique on write. */
	name: string;
	folder: boolean;
	files: readonly ExportFile[];
	notes: readonly ExportNote[];
	/** The pi files it was built from: a credential they hold under a secret-named key may appear in no file. */
	sources: readonly string[];
}

/** A file of a workspace tree as an embedder hands it over (ThinkRail: a turn's git tree). */
export interface TreeFile {
	path: string;
	bytes: Uint8Array;
}

export function exportFailure(
	kind: ExportKind,
	code: Extract<ExportResult, { ok: false }>["code"],
	detail = "",
	found: readonly ExportCheckFinding[] = [],
): ExportResult {
	return { apiVersion: SESSION_INSIGHTS_API_VERSION, ok: false, kind, code, found, detail };
}

/**
 * Every key and string value of a parsed JSON value through `check`, and a `jsonKey` finding for an
 * unmasked string at or under a secret-named key (`secretUnder`: inside a secret-named object or array
 * too).
 */
function jsonFindings(
	value: unknown,
	check: (text: string) => void,
	found: Set<ExportCheckFinding>,
	secret = false,
): void {
	if (typeof value === "string") {
		check(value);
		if (secret && value !== "" && value !== REDACTED) found.add("jsonKey");
	} else if (Array.isArray(value))
		for (const item of value) jsonFindings(item, check, found, secret);
	else if (isRecord(value))
		for (const [name, item] of Object.entries(value)) {
			check(name);
			jsonFindings(item, check, found, secretUnder(name, secret));
		}
}

function findingsOf(
	file: ExportFile,
	secrets: (text: string) => SecretKind[],
	known: readonly string[],
): ExportCheckFinding[] {
	const found = new Set<ExportCheckFinding>();
	const text = typeof file.content === "string" ? file.content : textOf(file.content);
	if (text === null) return [];
	const check = (item: string) => {
		for (const kind of secrets(item)) found.add(kind);
		if (known.length > 0 && !found.has("jsonKey") && known.some((value) => item.includes(value)))
			found.add("jsonKey");
	};
	switch (file.check) {
		case "html": {
			const parts = pageParts(text);
			for (const item of parts.texts) check(item);
			if (networkReferences(parts).length > 0) found.add("networkReference");
			break;
		}
		case "json":
			jsonFindings(JSON.parse(text), check, found);
			break;
		case "jsonl":
			for (const line of text.split("\n"))
				if (line.trim()) jsonFindings(JSON.parse(line), check, found);
			break;
		case "text":
			check(text);
			break;
	}
	return [...found];
}

/**
 * The post-export self-check over everything an export would write: any secret-like text that masking
 * would still change, string by string (or a network reference in a page's markup), and any of the
 * `known` credentials of its sources (`sourceCredentials`) anywhere — which catches a value that left
 * its secret-named key, say as a label. Best effort: it knows the redactor's rules and those values,
 * nothing more.
 */
export function checkExport(
	files: readonly ExportFile[],
	home: string = homedir(),
	known: readonly string[] = [],
): ExportCheckFinding[] {
	const secrets = secretChecker(home);
	const found = new Set<ExportCheckFinding>();
	for (const file of files) for (const kind of findingsOf(file, secrets, known)) found.add(kind);
	return [...found].sort();
}

const CREDENTIAL_CHARS = 8;
const NEEDLE_CHARS = 32;
const PLACEHOLDER = /^(?:\$|<|\{\{|%|process\.env\.|\/|~\/|\.{1,2}\/|[A-Za-z]:\\)/;

/**
 * Whether a string under a secret-named key looks like a credential worth looking for elsewhere: 8+
 * characters without whitespace, letters with a digit or a symbol, and not a placeholder or a path
 * (`${TOKEN}`, `<key>`, `{{secret}}`, `process.env.KEY`, `~/.ssh/id_rsa`) — so `password` or `changeme`
 * as a value never fails an export that mentions the word.
 */
function credentialLike(value: string): boolean {
	return (
		value.length >= CREDENTIAL_CHARS &&
		value !== REDACTED &&
		!/\s/.test(value) &&
		!PLACEHOLDER.test(value) &&
		/[A-Za-z]/.test(value) &&
		/[^A-Za-z]/.test(value)
	);
}

function collectCredentials(value: unknown, secret: boolean, out: Set<string>, depth = 0): void {
	if (typeof value === "string") {
		if (!secret || !credentialLike(value)) return;
		if (value.length <= NEEDLE_CHARS) out.add(value);
		else {
			out.add(value.slice(0, NEEDLE_CHARS));
			out.add(value.slice(-NEEDLE_CHARS));
		}
		return;
	}
	if (value === null || typeof value !== "object" || depth > 40) return;
	if (Array.isArray(value))
		for (const item of value) collectCredentials(item, secret, out, depth + 1);
	else
		for (const [key, item] of Object.entries(value))
			collectCredentials(item, secretUnder(key, secret), out, depth + 1);
}

/**
 * The credentials pi files hold under secret-named keys (`credentialLike` values, at any depth of any
 * entry; a long one by its first and last 32 characters, so a cut copy is caught too), for
 * `checkExport`. Unreadable files add nothing.
 */
export async function sourceCredentials(files: readonly string[]): Promise<string[]> {
	const out = new Set<string>();
	for (const file of new Set(files)) {
		try {
			const { tail } = await scanFile(
				file,
				0,
				Number.POSITIVE_INFINITY,
				(entry) => collectCredentials(entry, false, out),
				sliceYielder(8),
			);
			if (tail) collectCredentials(tail.entry, false, out);
		} catch {}
	}
	return [...out].sort();
}

function errnoOf(error: unknown): string {
	return typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof error.code === "string"
		? error.code
		: "unknown";
}

const MAX_NAMES = 10_000;

/** The `n`-th name an export may take: `name`, then `stem-2.ext`, `stem-3.ext`… (a folder has no extension). */
function nameAt(name: string, folder: boolean): (n: number) => string {
	const dot = folder ? -1 : name.indexOf(".");
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const extension = dot > 0 ? name.slice(dot) : "";
	return (n) => (n === 1 ? name : `${stem}-${n}${extension}`);
}

function noFreeName(): Error {
	return Object.assign(new Error("No free export name"), { code: "EEXIST" });
}

/** How a finished temporary file or folder takes its name; a test swaps them for a file system without hard links or folder replacement. */
export interface PublishOps {
	link(existing: string, path: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
}

const FILE_SYSTEM: PublishOps = { link, rename };

/**
 * Gives the finished file `partial` the first free name in `dir` (`nameAt`), never replacing anything:
 * a hard link to the name (taken: the next one), so the name appears only with the whole file; where the
 * file system has no hard links, an exclusive create reserves the name and the file is renamed over that
 * empty reservation. Returns the name taken.
 */
export async function publishFile(
	dir: string,
	names: (n: number) => string,
	partial: string,
	ops: PublishOps = FILE_SYSTEM,
): Promise<string> {
	let links = true;
	for (let n = 1; n <= MAX_NAMES; n++) {
		const leaf = names(n);
		const final = join(dir, leaf);
		if (links) {
			try {
				await ops.link(partial, final);
				await rm(partial, { force: true }).catch(() => {});
				return leaf;
			} catch (error) {
				if (errnoOf(error) === "EEXIST") continue;
				links = false;
			}
		}
		try {
			await (await open(final, "wx")).close();
		} catch (error) {
			if (errnoOf(error) === "EEXIST") continue;
			throw error;
		}
		try {
			await ops.rename(partial, final);
		} catch (error) {
			await rm(final, { force: true }).catch(() => {});
			throw error;
		}
		return leaf;
	}
	throw noFreeName();
}

/**
 * Gives the finished folder `partial` the first free name in `dir`, never replacing anything: `mkdir`
 * reserves the name (taken: the next one), then the folder is renamed over its empty reservation in one
 * step; where a folder cannot replace another (Windows), its `entries` move in one by one, in order (the
 * provenance last). Returns the name taken.
 */
export async function publishFolder(
	dir: string,
	names: (n: number) => string,
	partial: string,
	entries: readonly string[],
	ops: PublishOps = FILE_SYSTEM,
): Promise<string> {
	for (let n = 1; n <= MAX_NAMES; n++) {
		const leaf = names(n);
		const final = join(dir, leaf);
		try {
			await mkdir(final);
		} catch (error) {
			if (errnoOf(error) === "EEXIST") continue;
			throw error;
		}
		try {
			await ops.rename(partial, final);
		} catch {
			try {
				for (const entry of entries) await ops.rename(join(partial, entry), join(final, entry));
			} catch (error) {
				await rm(final, { recursive: true, force: true }).catch(() => {});
				throw error;
			}
			await rm(partial, { recursive: true, force: true }).catch(() => {});
		}
		return leaf;
	}
	throw noFreeName();
}

/** Each file's first path segment, once, in the order the files come. */
function topEntries(files: readonly ExportFile[]): string[] {
	return [...new Set(files.map((file) => file.path.split("/")[0] ?? ""))].filter(Boolean);
}

function byteLength(content: string | Uint8Array): number {
	return typeof content === "string" ? Buffer.byteLength(content) : content.byteLength;
}

/**
 * Checks, then writes an export under `<artifacts>/session-insights/`: a check finding writes nothing
 * (`CHECK_FAILED`); the output is written to a temporary path of its own beside the target, then takes
 * the first name no other export holds (`name-2.html`, …) atomically (`publishFile`, `publishFolder`),
 * so concurrent exports of one session never share a name or a temporary file.
 */
export async function writeExport(
	target: ExportTarget,
	output: ExportOutput,
	home?: string,
): Promise<ExportResult> {
	const found = checkExport(output.files, home, await sourceCredentials(output.sources));
	if (found.length > 0) return exportFailure(output.kind, "CHECK_FAILED", found.join(", "), found);
	const parent = join(target.dir, EXPORT_RULES.folder, ...dirname(output.name).split("/"));
	const partial = join(parent, `.${basename(output.name)}.${randomUUID()}.partial`);
	try {
		await mkdir(parent, { recursive: true });
		let bytes = 0;
		if (output.folder) {
			await mkdir(partial);
			for (const file of output.files) {
				const path = join(partial, ...file.path.split("/"));
				await mkdir(dirname(path), { recursive: true });
				await writeFile(path, file.content, { flag: "wx" });
				bytes += byteLength(file.content);
			}
		} else {
			const content = output.files[0]?.content ?? "";
			await writeFile(partial, content, { flag: "wx" });
			bytes = byteLength(content);
		}
		const names = nameAt(basename(output.name), output.folder);
		const leaf = output.folder
			? await publishFolder(parent, names, partial, topEntries(output.files))
			: await publishFile(parent, names, partial);
		const name = dirname(output.name) === "." ? leaf : `${dirname(output.name)}/${leaf}`;
		return {
			apiVersion: SESSION_INSIGHTS_API_VERSION,
			ok: true,
			kind: output.kind,
			path: `${target.relative}${EXPORT_RULES.folder}/${name}${output.folder ? "/" : ""}`,
			files: output.files.length,
			bytes,
			notes: output.notes,
		};
	} catch (error) {
		await rm(partial, { recursive: true, force: true }).catch(() => {});
		return exportFailure(output.kind, "WRITE_FAILED", errnoOf(error));
	}
}

/** `<day>-<title slug>-<session id head>`: what every export of a session is named after. */
export function exportBaseName(trace: BuiltTrace, title: string): string {
	const day =
		trace.meta.start === null ? "" : new Date(trace.meta.start).toISOString().slice(0, 10);
	const slug = fixtureName(title).slice(0, 40).replace(/-+$/g, "");
	return [day, slug, fixtureName(trace.sessionId).slice(0, 8)].filter(Boolean).join("-");
}

/** The Chrome-trace export: one `.trace.json` file. */
export function chromeTraceOutput(
	input: ChromeTraceInput & { base: string },
	notes: ExportNote[],
): ExportOutput {
	return {
		kind: "trace",
		name: `${input.base}.trace.json`,
		folder: false,
		files: [{ path: "", content: `${JSON.stringify(chromeTrace(input))}\n`, check: "json" }],
		notes,
		sources: [input.trace.file, ...[...input.children.values()].map((child) => child.file)],
	};
}

/** The run whose time overlaps a turn's span the most (touching counts), else `null`. */
export function receiptForTurn<T extends { startedAt: number; settledAt: number }>(
	receipts: readonly T[],
	span: { t0: number; t1: number },
): T | null {
	let best: T | null = null;
	let bestOverlap = Number.NEGATIVE_INFINITY;
	for (const receipt of receipts) {
		const overlap = Math.min(span.t1, receipt.settledAt) - Math.max(span.t0, receipt.startedAt);
		if (overlap >= 0 && overlap > bestOverlap) {
			best = receipt;
			bestOverlap = overlap;
		}
	}
	return best;
}

export interface FixtureInput {
	trace: BuiltTrace;
	cut: ExportCut;
	redactor: Redactor;
	base: string;
	name?: string;
	/** The workspace as the cut's turn left it, when the embedder has its tree; `tooLarge` past the limits. */
	snapshot: (cut: { t0: number; t1: number }) => Promise<readonly TreeFile[] | "tooLarge" | null>;
	labels: { labels: readonly string[]; note: string | null } | null;
}

/**
 * The e2e fixture export in the workflow harness's layout: `fixtures/<name>/session.jsonl` (the redacted
 * cut) plus `workspace/` — the turn tree's text files, redacted, `*.md` stored as `*.md.test` — only when
 * the cut is a turn's end and the embedder has that turn's tree; an `insights-export.json` records the
 * provenance (and the labels when asked). `null` when the cut names nothing.
 */
export async function fixtureOutput(input: FixtureInput): Promise<ExportOutput | null> {
	const session = await cutSessionFile(input.trace, input.cut, input.redactor);
	if (!session) return null;
	const { cut } = session;
	const notes: ExportNote[] = [];
	const files: ExportFile[] = [];
	const turnName = cut.turn ? `turn-${cut.turn.n}` : "start";
	const name = fixtureName(input.name ?? "") || `${input.base}-${turnName}`;
	const tree =
		cut.turn && cut.turnEnd ? await input.snapshot({ t0: cut.turn.t0, t1: cut.turn.t1 }) : null;
	if (tree === "tooLarge") notes.push("snapshotTooLarge");
	else if (tree === null) notes.push("noSnapshot");
	else {
		notes.push("snapshot");
		let binary = false;
		for (const file of [...tree].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
			if (
				file.path.startsWith("/") ||
				file.path.split("/").some((part) => part === ".." || part === "")
			)
				continue;
			const text = textOf(file.bytes);
			if (text === null) {
				binary = true;
				continue;
			}
			files.push({
				path: `workspace/${fixturePath(file.path)}`,
				content: input.redactor.redact(text),
				check: "text",
			});
		}
		if (binary) notes.push("binaryOmitted");
	}
	if (input.labels) notes.push("labels");
	const provenance = {
		exportedBy: "session insights",
		sessionId: input.trace.sessionId,
		revision: input.trace.meta.revision,
		cut: input.cut,
		entries: session.entries,
		recordedCwd: EXPORT_RULES.fixtureCwd,
		snapshot: notes.includes("snapshot") ? "turn tree" : null,
		...(input.labels
			? {
					labels: input.labels.labels.map((label) => input.redactor.redact(label)),
					note: input.labels.note === null ? null : input.redactor.clean(input.labels.note),
				}
			: {}),
	};
	return {
		kind: "fixture",
		name: `fixtures/${name}`,
		folder: true,
		files: [
			{ path: "session.jsonl", content: session.text, check: "jsonl" },
			...files,
			{
				path: "insights-export.json",
				content: `${JSON.stringify(provenance, null, 2)}\n`,
				check: "json",
			},
		],
		notes,
		sources: [input.trace.file],
	};
}
