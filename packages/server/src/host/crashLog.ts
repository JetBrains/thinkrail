import {
	appendFileSync,
	chmodSync,
	closeSync,
	constants,
	fchmodSync,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
} from "node:fs";
import { join } from "node:path";
import { reportFatalError } from "../analytics";
import { describeError } from "../log";
import { dataDir } from "../persistence";

export type CrashKind = "uncaughtException" | "unhandledRejection";

const MAX_RECORD_BYTES = 64 * 1024;
const TRUNCATED = "\n[crash report truncated]\n\n";
const STDERR_FLUSH_TIMEOUT_MS = 1_000;
const REDACTED = "[REDACTED]";
const SECRET_KEY = String.raw`[\w.-]*(?:passwords?|passwd|pwd|passphrase|secrets?|tokens?|(?:api|private|secret|access|auth|signing)[-_]?keys?(?:[-_]?id)?|authorization|credentials?|cookies?)`;
const SECRET_FIELD = new RegExp(`^(?:${SECRET_KEY})$`, "i");
const SECRET_ASSIGNMENT = new RegExp(
	String.raw`((?<![\w.-])["']?${SECRET_KEY}["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:Bearer|Basic)\s+[^\s,;&}\]]+|[^\s,;&}\]]+)`,
	"gi",
);

function redactSecrets(text: string): string {
	return text
		.replace(/(\b[a-z][a-z\d+.-]{0,31}:\/\/)[^/\s@]+@/gi, `$1${REDACTED}@`)
		.replace(
			/((?<![\w.-])(?:(?:proxy-)?authorization|(?:set-)?cookie)\s*:\s*)[^\r\n]*/gi,
			`$1${REDACTED}`,
		)
		.replace(SECRET_ASSIGNMENT, `$1"${REDACTED}"`)
		.replace(/\b(Bearer|Basic)\s+[a-z\d._~+/-]+=*/gi, `$1 ${REDACTED}`)
		.replace(
			/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z]+ )?PRIVATE KEY-----|$)/g,
			REDACTED,
		);
}

function boundRecord(record: string): string {
	const bytes = Buffer.from(record);
	if (bytes.length <= MAX_RECORD_BYTES) return record;
	let end = MAX_RECORD_BYTES - Buffer.byteLength(TRUNCATED);
	while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
	return bytes.subarray(0, end).toString("utf8") + TRUNCATED;
}

function appendRecord(path: string, record: string): void {
	const directory = join(path, "..");
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	if (!lstatSync(directory).isDirectory()) throw new Error("Invalid crash log directory");
	chmodSync(directory, 0o700);
	const fd = openSync(
		path,
		constants.O_WRONLY |
			constants.O_CREAT |
			constants.O_APPEND |
			constants.O_NOFOLLOW |
			constants.O_NONBLOCK,
		0o600,
	);
	try {
		if (!fstatSync(fd).isFile()) throw new Error("Invalid crash log file");
		fchmodSync(fd, 0o600);
		appendFileSync(fd, record);
	} finally {
		closeSync(fd);
	}
}

export function crashLogPath(): string {
	return join(dataDir(), "logs", "crash.log");
}

export function formatCrashRecord(
	kind: CrashKind,
	error: unknown,
	at: Date,
	uptimeSeconds: number,
	appVersion?: string,
): string {
	const build = appVersion ?? "source";
	const detail = describeError(error, (key, value) => (SECRET_FIELD.test(key) ? REDACTED : value));
	return boundRecord(
		redactSecrets(
			`[${at.toISOString()}] ${kind} (thinkrail ${build}, up ${Math.round(uptimeSeconds)}s)\n${detail}\n\n`,
		),
	);
}

let installed = false;

export function installCrashLog(appVersion?: string): void {
	if (installed || process.env.NODE_ENV === "test") return;
	installed = true;
	let crashing = false;
	const pending = new Set<Promise<void>>();
	const writeStderr = (text: string): void => {
		const flushed = new Promise<void>((resolve) => {
			try {
				process.stderr.write(text, () => resolve());
			} catch {
				resolve();
			}
		});
		pending.add(flushed);
		void flushed.then(() => pending.delete(flushed));
	};
	const flushStderr = async (): Promise<void> => {
		if (pending.size === 0) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				(async () => {
					while (pending.size > 0) await Promise.all(pending);
				})(),
				new Promise<void>((resolve) => {
					timer = setTimeout(resolve, STDERR_FLUSH_TIMEOUT_MS);
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	};
	const report = (kind: CrashKind, error: unknown): void => {
		const first = !crashing;
		crashing = true;
		if (first) {
			try {
				process.stderr.on("error", () => {});
			} catch {}
		}
		let record: string;
		try {
			record = formatCrashRecord(kind, error, new Date(), process.uptime(), appVersion);
		} catch {
			record = `[${kind}] crash report formatting failed\n\n`;
		}
		let output = `\nthinkrail host: fatal ${kind}\n${record}`;
		try {
			const path = crashLogPath();
			appendRecord(path, record);
			output += `thinkrail host: wrote crash report to ${path}\n`;
		} catch {
			output += "thinkrail host: could not write the crash report\n";
		}
		writeStderr(output);
		if (!first) return;
		void reportFatalError(error, kind).finally(async () => {
			await flushStderr();
			process.exit(1);
		});
	};
	process.on("uncaughtException", (error) => report("uncaughtException", error));
	process.on("unhandledRejection", (reason) => report("unhandledRejection", reason));
}
