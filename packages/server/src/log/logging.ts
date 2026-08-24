import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { format } from "node:util";
import { dataDir } from "../persistence";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const MAX_LOG_FILE_BYTES = 10 * 1024 * 1024;
export const LOG_RETENTION_DAYS = 14;

const LOG_FILE_RE = /^thinkrail-(\d{4}-\d{2}-\d{2})(?:_(\d+))?\.log$/;
const DAY_MS = 86_400_000;

export function isLogLevel(value: string): value is LogLevel {
	return (LOG_LEVELS as readonly string[]).includes(value);
}

export function shouldLog(level: LogLevel, threshold: LogLevel): boolean {
	return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(threshold);
}

export function resolveLogLevel(
	option: LogLevel | undefined,
	env: string | undefined,
): { level: LogLevel; invalidEnv: boolean } {
	if (option) return { level: option, invalidEnv: false };
	if (env === undefined || env === "") return { level: "info", invalidEnv: false };
	if (isLogLevel(env)) return { level: env, invalidEnv: false };
	return { level: "info", invalidEnv: true };
}

export function logDay(at: Date): string {
	return at.toISOString().slice(0, 10);
}

export function logFileName(day: string, sequence: number): string {
	return sequence === 0 ? `thinkrail-${day}.log` : `thinkrail-${day}_${sequence}.log`;
}

export function parseLogFileName(name: string): { day: string; sequence: number } | null {
	const match = LOG_FILE_RE.exec(name);
	if (!match?.[1]) return null;
	return { day: match[1], sequence: match[2] ? Number(match[2]) : 0 };
}

export function latestLogSequence(names: readonly string[], day: string): number | null {
	let latest: number | null = null;
	for (const name of names) {
		const parsed = parseLogFileName(name);
		if (parsed?.day !== day) continue;
		if (latest === null || parsed.sequence > latest) latest = parsed.sequence;
	}
	return latest;
}

export function selectRetentionVictims(
	names: readonly string[],
	today: string,
	retentionDays: number,
): string[] {
	const cutoff = Date.parse(`${today}T00:00:00Z`) - retentionDays * DAY_MS;
	return names.filter((name) => {
		const parsed = parseLogFileName(name);
		return parsed !== null && Date.parse(`${parsed.day}T00:00:00Z`) < cutoff;
	});
}

export function describeError(error: unknown): string {
	try {
		if (error instanceof Error) {
			const { stack } = error;
			return typeof stack === "string" && stack ? stack : `${error.name}: ${error.message}`;
		}
		if (typeof error === "string") return `Non-Error thrown: ${error}`;
		return `Non-Error thrown: ${JSON.stringify(error) ?? String(error)}`;
	} catch {}
	try {
		return `Unrenderable throw: ${String(error)}`;
	} catch {
		return `Unrenderable throw (${typeof error})`;
	}
}

export function formatLogLine(
	at: Date,
	level: LogLevel,
	scope: string,
	message: string,
	error?: unknown,
): string {
	const base = `${at.toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
	if (error === undefined) return base;
	const rendered = describeError(error)
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");
	return `${base}\n${rendered}`;
}

export class LogFileWriter {
	private day = "";
	private sequence = 0;
	private bytes = 0;
	private opened = false;

	constructor(
		private readonly dir: string,
		private readonly maxFileBytes = MAX_LOG_FILE_BYTES,
		private readonly retentionDays = LOG_RETENTION_DAYS,
	) {}

	append(line: string, at = new Date()): void {
		const day = logDay(at);
		if (!this.opened || day !== this.day) this.open(day);
		const record = `${line}\n`;
		const recordBytes = Buffer.byteLength(record);
		if (this.bytes > 0 && this.bytes + recordBytes > this.maxFileBytes) {
			this.sequence += 1;
			this.bytes = 0;
		}
		appendFileSync(this.path(), record);
		this.bytes += recordBytes;
	}

	path(): string {
		return join(this.dir, logFileName(this.day, this.sequence));
	}

	private open(day: string): void {
		mkdirSync(this.dir, { recursive: true });
		const names = readdirSync(this.dir);
		this.day = day;
		this.sequence = latestLogSequence(names, day) ?? 0;
		this.bytes = fileSize(this.path());
		if (this.bytes >= this.maxFileBytes) {
			this.sequence += 1;
			this.bytes = 0;
		}
		this.opened = true;
		for (const victim of selectRetentionVictims(names, day, this.retentionDays)) {
			try {
				unlinkSync(join(this.dir, victim));
			} catch {}
		}
	}
}

function fileSize(path: string): number {
	try {
		return statSync(path).size;
	} catch {
		return 0;
	}
}

let currentLevel: LogLevel = "info";
let writer: LogFileWriter | null = null;
let initialized = false;
let teeInstalled = false;

export function setLogLevel(level: LogLevel): void {
	currentLevel = level;
}

function writeToFile(line: string): void {
	if (!writer) return;
	try {
		writer.append(line);
	} catch {}
}

function emit(level: LogLevel, scope: string, message: string, error?: unknown): void {
	if (!shouldLog(level, currentLevel)) return;
	const line = formatLogLine(new Date(), level, scope, message, error);
	try {
		process.stderr.write(`${line}\n`);
	} catch {}
	writeToFile(line);
}

export interface Logger {
	debug(message: string, error?: unknown): void;
	info(message: string, error?: unknown): void;
	warn(message: string, error?: unknown): void;
	error(message: string, error?: unknown): void;
}

export function logger(scope: string): Logger {
	return {
		debug: (message, error?) => emit("debug", scope, message, error),
		info: (message, error?) => emit("info", scope, message, error),
		warn: (message, error?) => emit("warn", scope, message, error),
		error: (message, error?) => emit("error", scope, message, error),
	};
}

const CONSOLE_TEE: ReadonlyArray<readonly ["debug" | "log" | "info" | "warn" | "error", LogLevel]> =
	[
		["debug", "debug"],
		["log", "info"],
		["info", "info"],
		["warn", "warn"],
		["error", "error"],
	];

function installConsoleTee(): void {
	if (teeInstalled) return;
	teeInstalled = true;
	for (const [method, level] of CONSOLE_TEE) {
		const original = console[method].bind(console);
		console[method] = (...args: unknown[]) => {
			original(...args);
			if (!shouldLog(level, currentLevel)) return;
			writeToFile(formatLogLine(new Date(), level, "console", format(...args)));
		};
	}
}

export function logsDir(): string {
	return join(dataDir(), "logs");
}

export interface InitLoggingOptions {
	level?: LogLevel;
	appVersion?: string;
}

export function initLogging(options: InitLoggingOptions = {}): void {
	const { level, invalidEnv } = resolveLogLevel(options.level, process.env.THINKRAIL_LOG_LEVEL);
	setLogLevel(level);
	if (initialized) return;
	initialized = true;
	writer = new LogFileWriter(logsDir());
	installConsoleTee();
	const log = logger("log");
	if (invalidEnv) {
		log.warn(
			`THINKRAIL_LOG_LEVEL=${process.env.THINKRAIL_LOG_LEVEL} is not a level (debug|info|warn|error); using info`,
		);
	}
	log.info(
		`logging to ${logsDir()} (thinkrail ${options.appVersion ?? "source"}, pid ${process.pid}, level ${level})`,
	);
}
