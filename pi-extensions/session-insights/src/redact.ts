import { homedir } from "node:os";
import type { CappedJson, CappedText, ExportCheckFinding, JsonCut } from "./core.ts";
import { isWindowsPath } from "./paths.ts";

/** What every masked secret becomes. */
export const REDACTED = "[redacted]";
/**
 * Characters masked on each side of a kept window before it is cut, so a secret crossing the window's
 * edge is masked with the text that names it (a 4096-bit PEM block is about 3.3 KB, a 16384-bit one
 * 12.7 KB). A text no longer than its windows plus this on each side is masked whole.
 */
export const MASK_CONTEXT = 32 * 1024;
const MAX_ARRAY = 300;
const MAX_DEPTH = 10;
const HEAD_SHARE = 0.7;

type Replacement = string | ((...groups: string[]) => string);

/** What a masked pattern looked like, for the post-export check (never the match itself). */
export type SecretKind = Exclude<ExportCheckFinding, "networkReference">;

const SECRET_NAME =
	/.key$|token$|credentials?$|auth(?:orization)?$|api[_-]?key|secret|passw(?:or)?d/i;

/**
 * Whether a JSON key or variable name holds a secret: one ending in `…key` (not a bare `key`), `token`,
 * `credential(s)`, `auth` or `authorization`, or holding `api_key`, `secret` or `password` / `passwd`
 * anywhere, in any case (`apiKey`, `DB_PASSWORD`, `client_secret`, `x-auth-token`, `proxyAuth`; not
 * `tokenizer`, `max_tokens`, `author` or `authMode`).
 */
export function isSecretName(name: string): boolean {
	return SECRET_NAME.test(name);
}

/**
 * Whether the value under `key` is secret: the key is secret-named, or the value sits inside one that
 * was (`inherited`). Every JSON walk carries this flag down through objects and arrays, so nothing
 * inside a secret-named container leaves unmasked, however deep and whatever its own name.
 */
export function secretUnder(key: string, inherited: boolean): boolean {
	return inherited || isSecretName(key);
}

/**
 * A JSON leaf that masking replaces under a secret-named key: a non-empty string, a number or a
 * boolean (every view shows them as text). `""` and `null` hold nothing and stay.
 */
export function isSecretLeaf(value: unknown): boolean {
	return (
		(typeof value === "string" && value !== "") ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
}

/**
 * `value` with every leaf at or under a secret-named key (`secretUnder`, `isSecretLeaf`) replaced by
 * `[redacted]`, at any depth, and anything past the depth limit replaced whole; parts without one are
 * shared, not copied. What a label, a serialized argument or a search text is built from, so no value is
 * picked from under a secret-named key.
 */
export function maskSecretFields(value: unknown, secret = false, depth = 0): unknown {
	if (secret && isSecretLeaf(value)) return REDACTED;
	if (value === null || typeof value !== "object") return value;
	if (depth > MAX_DEPTH * 4) return REDACTED;
	if (Array.isArray(value)) {
		let out: unknown[] | null = null;
		value.forEach((item, index) => {
			const masked = maskSecretFields(item, secret, depth + 1);
			if (masked === item) return;
			out ??= [...value];
			out[index] = masked;
		});
		return out ?? value;
	}
	let out: Record<string, unknown> | null = null;
	for (const [key, item] of Object.entries(value)) {
		const masked = maskSecretFields(item, secretUnder(key, secret), depth + 1);
		if (masked === item) continue;
		out ??= { ...value };
		Object.defineProperty(out, key, {
			value: masked,
			enumerable: true,
			writable: true,
			configurable: true,
		});
	}
	return out ?? value;
}

const PEM_KEY = "[A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?";
const LINE_BREAK = String.raw`(?:\r?\n|(?:\\r)?\\n)`;
const B64 = "[A-Za-z0-9+/]";

/** A dangling END marker with the body line before it: both masked, the line break between kept. */
function maskKeyEnd(match: string): string {
	const at = match.indexOf("-----END");
	if (at === 0) return REDACTED;
	const gap = /[ \t]*(?:\r?\n|(?:\\r)?\\n)[ \t]*$/.exec(match.slice(0, at))?.[0] ?? "";
	return `${REDACTED}${gap}${REDACTED}`;
}

/** `[kind, pattern, replacement, needle]`: a pattern runs only on a string holding its needle. */
const SECRET_PATTERNS: readonly (readonly [SecretKind, RegExp, Replacement, string?])[] = [
	[
		"privateKey",
		new RegExp(`-----BEGIN ${PEM_KEY}-----[\\s\\S]*?(?:-----END ${PEM_KEY}-----|$)`, "g"),
		REDACTED,
		"-----BEGIN",
	],
	[
		"privateKey",
		new RegExp(
			`(?:(?<=^|")[ \\t]*${B64}{1,69}[ \\t]*${LINE_BREAK}|(?<=^|\\n|\\\\n|"))(?:[ \\t]*${B64}{64}(?:${B64}{6})?[ \\t]*${LINE_BREAK}){2,}(?:[ \\t]*${B64}{1,69}={0,2}(?=[ \\t]*(?:${LINE_BREAK}|$|")))?`,
			"g",
		),
		REDACTED,
	],
	[
		"privateKey",
		new RegExp(
			`(?<=^|[^A-Za-z0-9+/=]|\\\\[nr])(?:[A-Za-z0-9+/=]+[ \\t]*${LINE_BREAK}[ \\t]*)?-----END ${PEM_KEY}-----`,
			"g",
		),
		maskKeyEnd,
		"-----END",
	],
	["keyShape", /\b(?:sk|rk|pk)-(?:ant-|proj-|live-|test-|or-)?[A-Za-z0-9_-]{16,}/g, REDACTED],
	["keyShape", /\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
	["keyShape", /\bgithub_pat_[A-Za-z0-9_]{20,}/g, REDACTED],
	["keyShape", /\bglpat-[A-Za-z0-9_-]{20,}/g, REDACTED],
	["keyShape", /\bA(?:KIA|SIA)[0-9A-Z]{16}\b/g, REDACTED],
	["keyShape", /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, REDACTED],
	["keyShape", /\bAIza[0-9A-Za-z_-]{30,}/g, REDACTED],
	["keyShape", /\bnpm_[A-Za-z0-9]{30,}/g, REDACTED],
	["keyShape", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
	[
		"authHeader",
		/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
		(_, scheme) => `${scheme} ${REDACTED}`,
	],
	[
		"assignment",
		/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?))(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s"'`,;)…]+)/g,
		(_, name, separator) => `${name}${separator}${REDACTED}`,
	],
	[
		"queryValue",
		/(?<![A-Za-z0-9_-])([A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password|passwd))=([^\s&"'`…]+)/gi,
		(_, name) => `${name}=${REDACTED}`,
	],
	[
		"jsonKey",
		/"([^"\\\n]{1,100})"(\s*:\s*)"(?!")[^"\\\n]*(?:\\.[^"\\\n]*)*(?:"|$)/g,
		(match, name, separator) => (isSecretName(name) ? `"${name}"${separator}"${REDACTED}"` : match),
	],
	[
		"urlCredentials",
		/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g,
		(_, scheme) => `${scheme}${REDACTED}@`,
		"://",
	],
	["email", /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, REDACTED, "@"],
];

function replaceWith(text: string, pattern: RegExp, replacement: Replacement): string {
	return typeof replacement === "string"
		? text.replace(pattern, replacement)
		: text.replace(pattern, (...match: unknown[]) =>
				replacement(...match.filter((part): part is string => typeof part === "string")),
			);
}

/** What any home or secret pattern needs somewhere in a string (a path separator, `=`, `:`, `@`, a key's prefix, a PEM marker or body line); a string without it masks to itself. */
const MAY_MASK =
	/[\\/=:@]|-----(?:BEGIN|END)|\n[ \t]*[A-Za-z0-9+]{64}|[srp]k-|gh[pousr]_|github_pat_|glpat-|a[ks]ia|xox[abposr]-|aiza|npm_|eyj|bearer|basic|token/i;
const OTHER_HOME = /(?<![\w.~-])\/(?:home|Users)\/[A-Za-z0-9._-]+(?=\/|\b|$)/g;
/** `C:\Users\<name>` in any case and with either separator; a name with spaces only before a separator. */
const WINDOWS_HOME =
	/(?<![\w.~-])[A-Za-z]:[\\/]+Users[\\/]+(?:[^\\/\r\n"'<>|:*?]+(?=[\\/])|[A-Za-z0-9._-]+)/gi;
const ESC = 0x1b;
const BEL = 0x07;
const DEL = 0x7f;
const TAB = 0x09;
const LF = 0x0a;

function isCsiFinal(code: number): boolean {
	return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isCsiParameter(code: number): boolean {
	return (code >= 0x30 && code <= 0x39) || code === 0x3b || code === 0x3f;
}

/** Drops ANSI CSI and OSC sequences and control characters other than tab and line feed. */
export function stripControls(text: string): string {
	let out = "";
	let at = 0;
	while (at < text.length) {
		const code = text.charCodeAt(at);
		if (code === ESC && text[at + 1] === "[") {
			let end = at + 2;
			while (end < text.length && isCsiParameter(text.charCodeAt(end))) end += 1;
			if (end < text.length && isCsiFinal(text.charCodeAt(end))) {
				at = end + 1;
				continue;
			}
		} else if (code === ESC && text[at + 1] === "]") {
			let end = at + 2;
			while (end < text.length) {
				const next = text.charCodeAt(end);
				if (next === BEL) {
					end += 1;
					break;
				}
				if (next === ESC) {
					if (text[end + 1] === "\\") end += 2;
					break;
				}
				end += 1;
			}
			at = end;
			continue;
		}
		if ((code < 0x20 && code !== TAB && code !== LF) || code === DEL) {
			at += 1;
			continue;
		}
		out += text[at];
		at += 1;
	}
	return out;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The home folder as a pattern, or `null` for one that names no user: empty, the root (`/`, `C:\`) or a
 * single segment (`/root`), which would otherwise rewrite every absolute path. A Windows home matches in
 * any case and with either separator.
 */
function homePatternOf(home: string, flags: string): RegExp | null {
	const segments = home.split(/[\\/]+/).filter(Boolean);
	if (segments.length < 2) return null;
	if (!isWindowsPath(home))
		return new RegExp(`${escapeRegExp(home.replace(/[\\/]+$/, ""))}(?=/|\\b|$)`, flags);
	const prefix = home.startsWith("\\\\") ? "[\\\\/]{2}" : "";
	return new RegExp(
		`${prefix}${segments.map(escapeRegExp).join("[\\\\/]+")}(?=[\\\\/]|\\b|$)`,
		`${flags}i`,
	);
}

/** `at`, moved back to the start of a `[redacted]` it would split, so a cut never leaves half a mask. */
export function safeCut(text: string, at: number): number {
	for (let start = Math.max(0, at - REDACTED.length + 1); start < at; start++)
		if (text.startsWith(REDACTED, start)) return start;
	return at;
}

/** `at`, moved past a `[redacted]` it would split, for a kept tail. */
export function safeStart(text: string, at: number): number {
	for (let start = Math.max(0, at - REDACTED.length + 1); start < at; start++)
		if (text.startsWith(REDACTED, start)) return start + REDACTED.length;
	return at;
}

/** The masked text around a raw span (`Redactor.around`). */
export interface MaskedSpan {
	text: string;
	/** The span's start, estimated in `text`. */
	at: number;
	/** `text` begins at the raw text's start / reaches its end. */
	start: boolean;
	end: boolean;
}

export interface Redactor {
	/** Home → `~` and secret-shaped substrings → `[redacted]`. */
	redact(text: string): string;
	/** `redact` plus ANSI escapes and control characters stripped; line breaks kept. */
	clean(text: string): string;
	/**
	 * `clean` over the raw span `[from, to)` and `MASK_CONTEXT` characters on each side (the whole text
	 * when that covers it), for a window cut from masked text.
	 */
	around(text: string, from: number, to: number): MaskedSpan;
	/**
	 * A one-line label: masked (`around` its head), whitespace collapsed, cut to `max` characters with an
	 * ellipsis; `firstLine` keeps the masked text's first non-blank line only.
	 */
	label(text: string, max: number, firstLine?: boolean): string;
	/** Head-only cap, cut from the masked head (`around`). */
	cap(text: string, max: number): CappedText;
	/** 70 % head + 30 % tail for tool output, both cut from masked text; `cut` marks the omitted middle. */
	capHeadTail(text: string, max: number): CappedText;
	/**
	 * Strings cleaned and capped, every leaf at or under a secret-named key (`secretUnder`) masked whole,
	 * arrays ≤ 300 items, depth ≤ 10; cut strings are listed with their size.
	 */
	capJson(value: unknown, stringMax: number): CappedJson;
	/** `capJson` with smaller string caps until the serialized value fits `maxChars`. */
	capJsonWithin(value: unknown, stringMaxes: readonly number[], maxChars: number): CappedJson;
}

function countLines(text: string): number {
	let lines = 0;
	for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) lines += 1;
	return lines;
}

function firstLineOf(text: string): string {
	for (let at = 0; at < text.length; ) {
		const end = text.indexOf("\n", at);
		const line = text.slice(at, end < 0 ? text.length : end);
		if (line.trim()) return line;
		if (end < 0) break;
		at = end + 1;
	}
	return "";
}

/** Already-masked text as a one-line label: whitespace collapsed, cut to `max` with an ellipsis, never inside a mask. */
export function labelOf(masked: string, max: number, firstLine = false): string {
	const flat = (firstLine ? firstLineOf(masked) : masked).replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, safeCut(flat, max - 1))}…` : flat;
}

/** A masked head, and how far into the raw text its masking reached. */
interface MaskedHead {
	text: string;
	reach: number;
}

export function createRedactor(home: string = homedir()): Redactor {
	const homePattern = homePatternOf(home, "g");

	const redact = (text: string): string => {
		let out = homePattern ? text.replace(homePattern, "~") : text;
		out = out.replace(WINDOWS_HOME, "~").replace(OTHER_HOME, "~");
		for (const [, pattern, replacement, needle] of SECRET_PATTERNS)
			if (!needle || out.includes(needle)) out = replaceWith(out, pattern, replacement);
		return out;
	};

	const clean = (text: string): string => redact(stripControls(text.replace(/\r\n?/g, "\n")));

	const around = (text: string, from: number, to: number): MaskedSpan => {
		const start = Math.max(0, from - MASK_CONTEXT);
		const end = Math.min(text.length, to + MASK_CONTEXT);
		const masked = clean(start === 0 && end === text.length ? text : text.slice(start, end));
		return {
			text: masked,
			at: Math.round(((from - start) * masked.length) / Math.max(1, end - start)),
			start: start === 0,
			end: end === text.length,
		};
	};

	const maskedHead = (text: string, max: number): MaskedHead => {
		const span = around(text, 0, max);
		return { text: span.text, reach: span.end ? Number.POSITIVE_INFINITY : max + MASK_CONTEXT };
	};

	const head = (
		text: string,
		max: number,
		masked = maskedHead(text, max),
	): { text: string; cut: boolean } => {
		const cut = masked.text.length > max || masked.reach < text.length;
		return { text: cut ? masked.text.slice(0, safeCut(masked.text, max)) : masked.text, cut };
	};

	const cap = (text: string, max: number): CappedText => {
		const kept = head(text, max);
		if (!kept.cut) return { text: kept.text, chars: text.length };
		const rest = text.slice(max);
		return {
			text: kept.text,
			chars: text.length,
			cut: { at: kept.text.length, chars: text.length - max, lines: countLines(rest) },
		};
	};

	const capHeadTail = (text: string, max: number): CappedText => {
		if (text.length <= max) return { text: clean(text), chars: text.length };
		const headChars = Math.round(max * HEAD_SHARE);
		const tailChars = max - headChars;
		const tailFrom = text.length - tailChars;
		let kept: string;
		let tail: string;
		if (headChars + MASK_CONTEXT >= tailFrom - MASK_CONTEXT) {
			const all = clean(text);
			if (all.length <= max) return { text: all, chars: text.length };
			kept = all.slice(0, safeCut(all, headChars));
			tail = all.slice(safeStart(all, all.length - tailChars));
		} else {
			kept = head(text, headChars).text;
			const masked = around(text, tailFrom, text.length).text;
			tail = masked.slice(safeStart(masked, Math.max(0, masked.length - tailChars)));
		}
		const omitted = text.slice(headChars, tailFrom);
		return {
			text: kept + tail,
			chars: text.length,
			cut: { at: kept.length, chars: omitted.length, lines: countLines(omitted) },
		};
	};

	/** A string's masked head for a cap of `max`, reused from `memo` when an earlier, wider cap reached far enough. */
	const headOf = (value: string, max: number, memo: Map<string, MaskedHead>) => {
		let masked = memo.get(value);
		if (!masked || masked.reach < Math.min(value.length, max + MASK_CONTEXT)) {
			masked = maskedHead(value, max);
			memo.set(value, masked);
		}
		return head(value, max, masked);
	};

	const walk = (
		value: unknown,
		stringMax: number,
		cuts: JsonCut[],
		path: string,
		depth: number,
		memo: Map<string, MaskedHead>,
		secret = false,
	) => {
		if (secret && isSecretLeaf(value)) return REDACTED;
		if (value === null || typeof value === "number" || typeof value === "boolean") return value;
		if (typeof value === "string") {
			const kept = headOf(value, stringMax, memo);
			if (kept.cut) cuts.push([path || "$", value.length]);
			return kept.text;
		}
		if (depth > MAX_DEPTH) return "[…]";
		if (Array.isArray(value)) {
			if (value.length > MAX_ARRAY) cuts.push([path || "$", value.length]);
			return value
				.slice(0, MAX_ARRAY)
				.map((item, index): unknown =>
					walk(item, stringMax, cuts, `${path}[${index}]`, depth + 1, memo, secret),
				);
		}
		if (typeof value === "object") {
			const out: Record<string, unknown> = {};
			for (const [key, item] of Object.entries(value)) {
				const safeKey = redact(key);
				Object.defineProperty(out, safeKey, {
					value: walk(
						item,
						stringMax,
						cuts,
						path ? `${path}.${safeKey}` : safeKey,
						depth + 1,
						memo,
						secretUnder(key, secret),
					),
					enumerable: true,
					writable: true,
					configurable: true,
				});
			}
			return out;
		}
		return head(String(value), stringMax).text;
	};

	const capJson = (
		value: unknown,
		stringMax: number,
		memo = new Map<string, MaskedHead>(),
	): CappedJson => {
		const cuts: JsonCut[] = [];
		return { value: walk(value ?? null, stringMax, cuts, "", 0, memo), cuts };
	};

	const capJsonWithin = (
		value: unknown,
		stringMaxes: readonly number[],
		maxChars: number,
	): CappedJson => {
		let last: CappedJson = { value: null, cuts: [] };
		const memo = new Map<string, MaskedHead>();
		for (const stringMax of stringMaxes) {
			last = capJson(value, stringMax, memo);
			if (JSON.stringify(last.value).length <= maxChars) return last;
		}
		const serialized = JSON.stringify(value ?? null) ?? "";
		const keys =
			value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
		return {
			value: { omitted: true, keys: keys.map(redact), chars: serialized.length },
			cuts: [["$", serialized.length]],
		};
	};

	const label = (text: string, max: number, firstLine = false): string => {
		const from = text.search(/\S/);
		if (from < 0) return "";
		return labelOf(maskedHead(from > 0 ? text.slice(from) : text, max).text, max, firstLine);
	};

	return { redact, clean, around, label, cap, capHeadTail, capJson, capJsonWithin };
}

/**
 * The post-export check for one home folder: the kinds of secret-like text that masking would still
 * change in a string (a home folder, a key shape, a credential…), so an output that skipped the redactor
 * fails instead of leaving. Already-masked text passes, since masking it again changes nothing. Best
 * effort, like the masking. The patterns are compiled once, for checking many strings.
 */
export function secretChecker(home: string = homedir()): (text: string) => SecretKind[] {
	const homePattern = homePatternOf(home, "");
	const otherHome = new RegExp(OTHER_HOME.source);
	const windowsHome = new RegExp(WINDOWS_HOME.source, "i");
	return (text) => {
		if (!MAY_MASK.test(text)) return [];
		const found = new Set<SecretKind>();
		if (homePattern?.test(text) || otherHome.test(text) || windowsHome.test(text))
			found.add("homePath");
		for (const [kind, pattern, replacement, needle] of SECRET_PATTERNS) {
			if (found.has(kind) || (needle && !text.includes(needle))) continue;
			pattern.lastIndex = 0;
			if (pattern.test(text) && replaceWith(text, pattern, replacement) !== text) found.add(kind);
		}
		return [...found];
	};
}

/** `secretChecker(home)` over one string. */
export function secretFindings(text: string, home: string = homedir()): SecretKind[] {
	return secretChecker(home)(text);
}
