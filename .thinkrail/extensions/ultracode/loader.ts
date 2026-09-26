import { guardedDate, guardedMath } from "./determinism";
import type { UltracodeMeta, UltracodeRuntimeApi } from "./types";

const REGEX_PRECEDING_KEYWORDS = new Set([
	"return",
	"typeof",
	"instanceof",
	"in",
	"of",
	"new",
	"delete",
	"void",
	"throw",
	"case",
	"do",
	"else",
	"yield",
	"await",
]);

const scanSource = (src: string) => {
	const out = new Array<string>(src.length);
	const depths = new Int32Array(src.length);
	const stack: Array<{ kind: "template" | "sub"; depth: number }> = [];
	let depth = 0;
	let i = 0;
	let prev = "";

	const startsRegex = (at: number) => {
		if (prev === "" || !/[\w$)\]]/.test(prev)) return true;
		if (!/[\w$]/.test(prev)) return false;
		let k = at - 1;
		while (k >= 0 && /\s/.test(src[k] ?? "")) k--;
		const end = k + 1;
		while (k >= 0 && /[\w$]/.test(src[k] ?? "")) k--;
		return REGEX_PRECEDING_KEYWORDS.has(src.slice(k + 1, end));
	};
	const blank = (from: number, to: number) => {
		for (let k = from; k < to && k < src.length; k++) out[k] = src[k] === "\n" ? "\n" : " ";
	};

	while (i < src.length) {
		const top = stack[stack.length - 1];
		const ch = src[i] ?? "";
		const next = src[i + 1];

		if (top?.kind === "template") {
			if (ch === "\\") {
				blank(i, i + 2);
				i += 2;
			} else if (ch === "$" && next === "{") {
				blank(i, i + 2);
				stack.push({ kind: "sub", depth });
				depth++;
				i += 2;
			} else if (ch === "`") {
				stack.pop();
				blank(i, i + 1);
				prev = "0";
				i++;
			} else {
				blank(i, i + 1);
				i++;
			}
			continue;
		}

		if (ch === "/" && next === "/") {
			const nl = src.indexOf("\n", i);
			const stop = nl === -1 ? src.length : nl;
			blank(i, stop);
			i = stop;
			continue;
		}
		if (ch === "/" && next === "*") {
			const end = src.indexOf("*/", i + 2);
			const stop = end === -1 ? src.length : end + 2;
			blank(i, stop);
			i = stop;
			continue;
		}
		if (ch === '"' || ch === "'") {
			let k = i + 1;
			while (k < src.length) {
				const c = src[k] ?? "";
				if (c === "\\") {
					k += 2;
					continue;
				}
				k++;
				if (c === ch || c === "\n") break;
			}
			blank(i, k);
			prev = "0";
			i = k;
			continue;
		}
		if (ch === "/" && startsRegex(i)) {
			let k = i + 1;
			let inClass = false;
			while (k < src.length) {
				const c = src[k] ?? "";
				if (c === "\\") {
					k += 2;
					continue;
				}
				if (c === "\n") break;
				k++;
				if (c === "[") inClass = true;
				else if (c === "]") inClass = false;
				else if (c === "/" && !inClass) break;
			}
			while (k < src.length && /[a-z]/.test(src[k] ?? "")) k++;
			blank(i, k);
			prev = "0";
			i = k;
			continue;
		}
		if (ch === "`") {
			stack.push({ kind: "template", depth });
			blank(i, i + 1);
			i++;
			continue;
		}
		if (ch === "}" && top?.kind === "sub" && depth === top.depth + 1) {
			depth = top.depth;
			stack.pop();
			blank(i, i + 1);
			i++;
			continue;
		}

		if (!/\s/.test(ch)) prev = ch;
		out[i] = ch;
		if (ch === "{" || ch === "[" || ch === "(") {
			depths[i] = depth;
			depth++;
		} else if (ch === "}" || ch === "]" || ch === ")") {
			depth = depth > 0 ? depth - 1 : 0;
			depths[i] = depth;
		} else {
			depths[i] = depth;
		}
		i++;
	}

	return { masked: out.join(""), depths };
};

const matchBracket = (masked: string, start: number) => {
	const open = masked[start] ?? "";
	const close = open === "{" ? "}" : open === "[" ? "]" : ")";
	let depth = 0;
	for (let i = start; i < masked.length; i++) {
		const ch = masked[i];
		if (ch === open) depth++;
		else if (ch === close && --depth === 0) return i;
	}
	return -1;
};

const lineOf = (src: string, index: number) => {
	let line = 1;
	for (let i = 0; i < index && i < src.length; i++) if (src[i] === "\n") line++;
	return line;
};

type LiteralValue =
	| string
	| number
	| boolean
	| null
	| LiteralValue[]
	| { [key: string]: LiteralValue };

const IDENT_START = /[A-Za-z_$]/;
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*/;
const NUMBER = /^[+-]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/;
const SIMPLE_ESCAPES: Record<string, string> = {
	n: "\n",
	t: "\t",
	r: "\r",
	b: "\b",
	f: "\f",
	v: "\v",
	"0": "\0",
};

const operatorConstruct = (ch: string) => {
	if (ch === "(") return "CallExpression";
	if (ch === "." || ch === "[") return "MemberExpression";
	if (ch === "`") return "TaggedTemplateExpression";
	if (ch === "?") return "ConditionalExpression";
	if ("+-*/%&|^<>=!".includes(ch)) return "BinaryExpression";
	return `token \`${ch}\``;
};

const parseLiteral = (text: string, baseLine: number): LiteralValue => {
	let pos = 0;

	const lineAt = (index: number) => baseLine + lineOf(text, index) - 1;
	const reject = (found: string, at = pos): never => {
		throw new Error(`meta must be a literal, found ${found} at line ${lineAt(at)}`);
	};
	const bad = (message: string, at = pos): never => {
		throw new Error(`meta literal is malformed: ${message} at line ${lineAt(at)}`);
	};

	const skip = () => {
		while (pos < text.length) {
			const ch = text[pos] ?? "";
			if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
				pos++;
			} else if (ch === "/" && text[pos + 1] === "/") {
				const nl = text.indexOf("\n", pos);
				pos = nl === -1 ? text.length : nl;
			} else if (ch === "/" && text[pos + 1] === "*") {
				const end = text.indexOf("*/", pos + 2);
				pos = end === -1 ? text.length : end + 2;
			} else {
				return;
			}
		}
	};

	const peekAfter = (from: number) => {
		const save = pos;
		pos = from;
		skip();
		const ch = text[pos];
		const at = pos;
		pos = save;
		return { ch, at };
	};

	const describeValue = (): string => {
		const ch = text[pos];
		if (ch === undefined) return "end of input";
		if (ch === "`") return "TemplateLiteral";
		if (ch === "(") {
			const scan = scanSource(text.slice(pos));
			const close = matchBracket(scan.masked, 0);
			if (close === -1) return "ParenthesizedExpression";
			const after = peekAfter(pos + close + 1);
			if (after.ch === "(") return "CallExpression";
			if (after.ch === "=" && text[after.at + 1] === ">") return "ArrowFunctionExpression";
			return "ParenthesizedExpression";
		}
		if (ch === "." && text.startsWith("...", pos)) return "SpreadElement";
		if (!IDENT_START.test(ch)) return `token \`${ch}\``;

		const word = IDENT.exec(text.slice(pos))?.[0] ?? "";
		if (word === "function") return "FunctionExpression";
		if (word === "class") return "ClassExpression";
		if (word === "new") return "NewExpression";
		if (word === "await") return "AwaitExpression";
		if (word === "async") return "AsyncFunctionExpression";
		const after = peekAfter(pos + word.length);
		if (after.ch === "(") return `CallExpression \`${word}(…)\``;
		if (after.ch === "=" && text[after.at + 1] === ">") return "ArrowFunctionExpression";
		if (after.ch === "." || after.ch === "[") return `MemberExpression \`${word}\``;
		return `Identifier \`${word}\``;
	};

	const readEscape = () => {
		pos++;
		const ch = text[pos];
		if (ch === undefined) return bad("string ends with a dangling escape");
		if (ch === "\n") {
			pos++;
			return "";
		}
		if (ch === "u") {
			pos++;
			if (text[pos] === "{") {
				const end = text.indexOf("}", pos);
				if (end === -1) return bad("unterminated \\u{…} escape");
				const code = Number.parseInt(text.slice(pos + 1, end), 16);
				if (Number.isNaN(code)) return bad("invalid \\u{…} escape");
				pos = end + 1;
				return String.fromCodePoint(code);
			}
			const code = Number.parseInt(text.slice(pos, pos + 4), 16);
			if (Number.isNaN(code)) return bad("invalid \\u escape");
			pos += 4;
			return String.fromCharCode(code);
		}
		if (ch === "x") {
			const code = Number.parseInt(text.slice(pos + 1, pos + 3), 16);
			if (Number.isNaN(code)) return bad("invalid \\x escape");
			pos += 3;
			return String.fromCharCode(code);
		}
		pos++;
		return SIMPLE_ESCAPES[ch] ?? ch;
	};

	const readString = () => {
		const quote = text[pos] ?? "";
		const start = pos;
		pos++;
		let value = "";
		while (pos < text.length) {
			const ch = text[pos] ?? "";
			if (ch === "\\") {
				value += readEscape();
				continue;
			}
			if (ch === quote) {
				pos++;
				return value;
			}
			if (ch === "\n") break;
			value += ch;
			pos++;
		}
		return bad("unterminated string", start);
	};

	const readNumber = () => {
		const m = NUMBER.exec(text.slice(pos));
		if (!m) return reject(`token \`${text[pos]}\``);
		const value = Number(m[0]);
		if (Number.isNaN(value)) return bad(`\`${m[0]}\` is not a number`);
		pos += m[0].length;
		return value;
	};

	const parseValue = (): LiteralValue => {
		skip();
		const ch = text[pos];
		if (ch === "{") return parseObject();
		if (ch === "[") return parseArray();
		if (ch === '"' || ch === "'") return readString();
		const isNumberStart =
			ch !== undefined &&
			(/[0-9]/.test(ch) ||
				(ch === "." && /[0-9]/.test(text[pos + 1] ?? "")) ||
				((ch === "-" || ch === "+") &&
					/[0-9.]/.test(text[pos + 1] ?? "") &&
					!text.startsWith("..", pos + 1)));
		if (isNumberStart) return readNumber();
		if (ch !== undefined && IDENT_START.test(ch)) {
			const word = IDENT.exec(text.slice(pos))?.[0] ?? "";
			const after = peekAfter(pos + word.length);
			const isBare =
				after.ch !== "(" &&
				after.ch !== "." &&
				after.ch !== "[" &&
				!(after.ch === "=" && text[after.at + 1] === ">");
			if (isBare && (word === "true" || word === "false" || word === "null")) {
				pos += word.length;
				return word === "null" ? null : word === "true";
			}
		}
		return reject(describeValue());
	};

	const parseKey = () => {
		const ch = text[pos];
		if (ch === '"' || ch === "'") return readString();
		if (ch !== undefined && /[0-9]/.test(ch)) return String(readNumber());
		if (ch === "[") return reject("ComputedProperty");
		if (ch === "." && text.startsWith("...", pos)) return reject("SpreadElement");
		if (ch === undefined || !IDENT_START.test(ch)) return reject(describeValue());
		const word = IDENT.exec(text.slice(pos))?.[0] ?? "";
		const after = peekAfter(pos + word.length);
		if (
			(word === "get" || word === "set") &&
			after.ch !== undefined &&
			IDENT_START.test(after.ch)
		) {
			return reject("ObjectAccessor");
		}
		if (word === "async") return reject("ObjectMethod");
		pos += word.length;
		return word;
	};

	const parseObject = (): LiteralValue => {
		pos++;
		const obj: Record<string, LiteralValue> = Object.create(null);
		for (;;) {
			skip();
			if (text[pos] === "}") {
				pos++;
				return obj;
			}
			if (pos >= text.length) return bad("unterminated object");
			const key = parseKey();
			skip();
			const sep = text[pos];
			if (sep === "(") return reject("ObjectMethod");
			if (sep === "," || sep === "}") return reject("ShorthandProperty");
			if (sep !== ":") return reject(sep === undefined ? "end of input" : operatorConstruct(sep));
			pos++;
			obj[key] = parseValue();
			skip();
			const nextCh = text[pos];
			if (nextCh === ",") {
				pos++;
				continue;
			}
			if (nextCh === "}") {
				pos++;
				return obj;
			}
			if (nextCh === undefined) return bad("unterminated object");
			return reject(operatorConstruct(nextCh));
		}
	};

	const parseArray = (): LiteralValue => {
		pos++;
		const arr: LiteralValue[] = [];
		for (;;) {
			skip();
			if (text[pos] === "]") {
				pos++;
				return arr;
			}
			if (pos >= text.length) return bad("unterminated array");
			if (text[pos] === ",") return bad("array holes are not allowed");
			arr.push(parseValue());
			skip();
			const nextCh = text[pos];
			if (nextCh === ",") {
				pos++;
				continue;
			}
			if (nextCh === "]") {
				pos++;
				return arr;
			}
			if (nextCh === undefined) return bad("unterminated array");
			return reject(operatorConstruct(nextCh));
		}
	};

	const value = parseValue();
	skip();
	if (pos < text.length) reject(operatorConstruct(text[pos] ?? ""));
	return value;
};

export const extractMeta = (source: string): UltracodeMeta => {
	const { masked } = scanSource(source);
	const m = /\bexport\s+const\s+meta\s*=\s*/.exec(masked);
	if (!m) throw new Error("ultracode script must `export const meta = { name, description, ... }`");
	const braceStart = m.index + m[0].length;
	if (masked[braceStart] !== "{") throw new Error("meta must be an object literal");
	const braceEnd = matchBracket(masked, braceStart);
	if (braceEnd === -1) throw new Error("meta object literal is not terminated");
	const meta = parseLiteral(source.slice(braceStart, braceEnd + 1), lineOf(source, braceStart));
	if (
		typeof meta !== "object" ||
		meta === null ||
		Array.isArray(meta) ||
		typeof meta.name !== "string" ||
		typeof meta.description !== "string"
	) {
		throw new Error("meta must include string `name` and `description`");
	}
	const phases = Array.isArray(meta.phases)
		? meta.phases.flatMap((phase) =>
				typeof phase === "object" &&
				phase !== null &&
				!Array.isArray(phase) &&
				typeof phase.title === "string"
					? [
							{
								title: phase.title,
								...(typeof phase.detail === "string" ? { detail: phase.detail } : {}),
							},
						]
					: [],
			)
		: undefined;
	return { name: meta.name, description: meta.description, ...(phases ? { phases } : {}) };
};

const isStatementStart = (masked: string, index: number) => {
	for (let i = index - 1; i >= 0; i--) {
		const ch = masked[i] ?? "";
		if (ch === "\n") return true;
		if (ch === " " || ch === "\t" || ch === "\r") continue;
		return ch === ";" || ch === "}" || ch === "{";
	}
	return true;
};

const toRunnableBody = (source: string) => {
	const { masked, depths } = scanSource(source);
	let metaExport = -1;

	for (const m of masked.matchAll(/\bexport\b/g)) {
		const at = m.index;
		if (depths[at] !== 0 || !isStatementStart(masked, at)) continue;
		if (metaExport === -1 && /^\s*const\s+meta\b/.test(masked.slice(at + 6, at + 48))) {
			metaExport = at;
			continue;
		}
		throw new Error(
			`ultracode scripts may not use \`export\` except \`export const meta\` (line ${lineOf(source, at)}). ` +
				"The script body runs as one function, so drop the keyword: top-level declarations are already visible to the whole script.",
		);
	}

	for (const m of masked.matchAll(/\bimport\b/g)) {
		const at = m.index;
		if (depths[at] !== 0 || !isStatementStart(masked, at)) continue;
		const after = /^\s*(\S)/.exec(masked.slice(at + 6))?.[1];
		if (after === "(") continue;
		throw new Error(
			`ultracode scripts cannot \`import\` (line ${lineOf(source, at)}). ` +
				"They run as a single function body with only the injected globals (agent, parallel, pipeline, phase, log, args) in scope. " +
				"Inline what you need, or have a spawned agent do the work.",
		);
	}

	if (metaExport === -1) return source;
	return `${source.slice(0, metaExport)}      ${source.slice(metaExport + 6)}`;
};

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
	...args: string[]
) => (...a: unknown[]) => Promise<unknown>;

export const runUltracodeScript = async (
	source: string,
	api: UltracodeRuntimeApi,
): Promise<unknown> => {
	const body = toRunnableBody(source);
	let fn: (...a: unknown[]) => Promise<unknown>;
	try {
		fn = new AsyncFunction(
			"agent",
			"parallel",
			"pipeline",
			"phase",
			"log",
			"args",
			"Date",
			"Math",
			body,
		);
	} catch (e) {
		const message = (e as Error).message;
		const collision = /already been declared|declare a (?:\w+ )?(?:variable|class) twice/.test(
			message,
		)
			? " — agent, parallel, pipeline, phase, log, args, Date and Math are bound as parameters; rename your declaration."
			: "";
		throw new Error(`ultracode script failed to compile: ${message}${collision}`);
	}
	return fn(
		api.agent,
		api.parallel,
		api.pipeline,
		api.phase,
		api.log,
		api.args,
		guardedDate,
		guardedMath,
	);
};
