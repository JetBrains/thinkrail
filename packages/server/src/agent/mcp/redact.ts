const MASK = "***";
const SECRET_WORD = "token|secret|passw(?:or)?d|api[-_ ]?key|auth|bearer|credential|session";
const SECRET_NAME = new RegExp(SECRET_WORD, "i");
const TOKEN_LITERAL = "(?:gh[pousr]_|github_pat_|sk-|xox[abprs]-|glpat-|AKIA)[A-Za-z0-9_-]{8,}";
const SECRET_VALUE = new RegExp(`^${TOKEN_LITERAL}`);

const URL_IN_TEXT = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'`<>]+/g;
const AUTH_SCHEME = /\b(bearer|basic)(\s+)(?!\*\*\*)[^\s"'`,;]+/gi;
const QUOTED_PAIR = new RegExp(
	String.raw`(["'])([^"'\s]*(?:${SECRET_WORD})[^"'\s]*)\1(\s*[:=]\s*)(?:(["'])(?:\\.|(?!\4)[^\\])*\4|[^\s"',;{}[\]]+)`,
	"gi",
);
const KEY_VALUE = new RegExp(String.raw`\b([\w.-]*(?:${SECRET_WORD})[\w.-]*)=[^\s&"'\`,;]+`, "gi");
const KEY_COLON = new RegExp(
	String.raw`\b([\w.-]*(?:${SECRET_WORD})[\w.-]*)(:[ \t]*)(?!\*\*\*|bearer\b|basic\b)(?:(["'])(?:\\.|(?!\3)[^\\\n])*\3|[^\s"',;{}[\]]+)`,
	"gi",
);
const TOKEN_IN_TEXT = new RegExp(String.raw`\b${TOKEN_LITERAL}`, "g");
const LONG_RUN = /(?<![A-Za-z0-9+_-])[A-Za-z0-9+_-]{32,}={0,2}/g;

const URL_ARG = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const ASSIGNMENT = /^(-{0,2}[\w.-]+)=(.*)$/s;
const HEADER_ARG = /^([A-Za-z0-9-]+):(\s*)(\S.*)$/s;
const HEADER_FLAGS = new Set(["-H", "--header", "--headers"]);

function isTokenRun(run: string): boolean {
	const body = run.replace(/=+$/, "");
	if (/^[0-9a-f]+$/i.test(body)) return /\d/.test(body);
	return /[a-z]/.test(body) && /[A-Z]/.test(body) && /\d/.test(body);
}

function maskUrl(raw: string): string {
	if (!URL.canParse(raw)) return raw;
	const url = new URL(raw);
	let masked = false;
	if (url.username) {
		url.username = MASK;
		masked = true;
	}
	if (url.password) {
		url.password = MASK;
		masked = true;
	}
	for (const key of new Set(url.searchParams.keys())) {
		if (!SECRET_NAME.test(key)) continue;
		url.searchParams.set(key, MASK);
		masked = true;
	}
	return masked ? url.toString() : raw;
}

export function redactMcpText(text: string): string {
	return text
		.replace(URL_IN_TEXT, (url) => maskUrl(url))
		.replace(AUTH_SCHEME, (_match, scheme: string, space: string) => `${scheme}${space}${MASK}`)
		.replace(QUOTED_PAIR, (_match, quote: string, key: string, separator: string, valueQuote) =>
			valueQuote
				? `${quote}${key}${quote}${separator}${valueQuote}${MASK}${valueQuote}`
				: `${quote}${key}${quote}${separator}${MASK}`,
		)
		.replace(KEY_VALUE, (_match, key: string) => `${key}=${MASK}`)
		.replace(KEY_COLON, (_match, key: string, separator: string, quote?: string) =>
			quote ? `${key}${separator}${quote}${MASK}${quote}` : `${key}${separator}${MASK}`,
		)
		.replace(TOKEN_IN_TEXT, MASK)
		.replace(LONG_RUN, (run) => (isTokenRun(run) ? MASK : run));
}

function maskHeaderArg(arg: string, afterHeaderFlag: boolean): string | undefined {
	const header = HEADER_ARG.exec(arg);
	const [, name, space = "", value = ""] = header ?? [];
	if (!name || (!afterHeaderFlag && !SECRET_NAME.test(name))) return undefined;
	return value.includes("${") ? arg : `${name}:${space}${MASK}`;
}

function maskArg(arg: string, flag: string | undefined): string {
	if (flag && !flag.includes("=") && SECRET_NAME.test(flag)) return MASK;
	const assignment = ASSIGNMENT.exec(arg);
	if (assignment?.[1] && assignment[2] !== undefined) {
		return `${assignment[1]}=${maskArg(assignment[2], assignment[1])}`;
	}
	if (URL_ARG.test(arg)) return maskUrl(arg);
	const header = maskHeaderArg(arg, flag !== undefined && HEADER_FLAGS.has(flag));
	if (header !== undefined) return header;
	return SECRET_VALUE.test(arg) ? MASK : arg;
}

function quoteArg(part: string): string {
	return part === "" || /[\s"'\\]/.test(part) ? JSON.stringify(part) : part;
}

export function maskMcpEndpoint(raw: Record<string, unknown>): string {
	if (typeof raw.url === "string") return maskUrl(raw.url);
	const command = typeof raw.command === "string" ? raw.command : "";
	const args = Array.isArray(raw.args)
		? raw.args.filter((arg): arg is string => typeof arg === "string")
		: [];
	const masked = args.map((arg, index) => {
		const previous = args[index - 1];
		return maskArg(arg, previous?.startsWith("-") ? previous : undefined);
	});
	return [command, ...masked]
		.filter((part, index) => index > 0 || part !== "")
		.map(quoteArg)
		.join(" ");
}
