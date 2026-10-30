/** Single-quote a string for POSIX sh: the only escape needed is the quote itself. */
export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

export interface RunScriptInput {
	prepare: readonly string[];
	target?: { command: string; cwd?: string };
	/** The file the script creates once prepare is done, before the target starts. */
	preparedSentinel: string;
}

const ECHO = "printf '\\033[2m$ %s\\033[0m\\n'";

/** `set -e`, prepare in order, the prepared sentinel, then the target last so the shell exits with its status (no `exec` — see run/SPEC.md). */
export function composeRunScript(input: RunScriptInput): string {
	const lines = ["set -e"];
	for (const command of input.prepare) {
		lines.push(`${ECHO} ${shellQuote(command)}`, command);
	}
	lines.push(`: > ${shellQuote(input.preparedSentinel)}`);
	if (input.target) {
		if (input.target.cwd && input.target.cwd !== ".") {
			lines.push(`cd ${shellQuote(input.target.cwd)}`);
		}
		lines.push(`${ECHO} ${shellQuote(input.target.command)}`, input.target.command);
	}
	return `${lines.join("\n")}\n`;
}

const ESC = "\u001b";
const BEL = "\u0007";
const OSC_RE = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "g");
const CSI_RE = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");
const NF_RE = new RegExp(`${ESC}[ -/]+[0-~]`, "g");
const ESCAPE_RE = new RegExp(`${ESC}[@-Z\\\\-_]`, "g");

/** Drop ANSI escape sequences and carriage-return rewrites so a recording reads as plain text. */
export function stripAnsi(text: string): string {
	return text
		.replace(OSC_RE, "")
		.replace(CSI_RE, "")
		.replace(NF_RE, "")
		.replace(ESCAPE_RE, "")
		.replace(/\r\n/g, "\n")
		.replace(/[^\n]*\r(?!\n)/g, "");
}

const LOOPBACK_URL =
	/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d{1,5})?(?:\/[^\s'"<>)\]]*)?/;

/** The first loopback URL a serve target prints, for targets whose recipe declares no `url`. */
export function discoverLoopbackUrl(text: string): string | null {
	const match = LOOPBACK_URL.exec(stripAnsi(text));
	return match ? match[0] : null;
}

/** Fill `${VAR}` placeholders from the resolved ports; every placeholder was validated as declared. */
export function resolveUrl(template: string, ports: Record<string, number>): string {
	return template.replace(/\$\{([^}]*)\}/g, (_, name: string) => String(ports[name] ?? ""));
}

export function urlPort(url: string): number | null {
	try {
		const parsed = new URL(url);
		if (parsed.port) return Number(parsed.port);
		return parsed.protocol === "https:" ? 443 : parsed.protocol === "http:" ? 80 : null;
	} catch {
		return null;
	}
}
