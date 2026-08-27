/// <reference path="./pino-roll.d.ts" />

import { join } from "node:path";
import pino, { type LoggerOptions, type Logger as PinoLogger } from "pino";
import pretty from "pino-pretty";
import buildPinoRoll, { type PinoRollOptions, type PinoRollStream } from "pino-roll";
import { removeOldFiles } from "pino-roll/lib/utils.js";
import { dataDir } from "../persistence";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_SCHEMA_VERSION = 1;
export const LOG_RETENTION_FILES = 14;
export const LOG_TOTAL_FILES = LOG_RETENTION_FILES + 1;
export const LOG_FILE_SIZE = "10m";

const SECRET_PATHS = [
	"password",
	"token",
	"accessToken",
	"refreshToken",
	"apiKey",
	"api_key",
	"authorization",
	"cookie",
	"headers.authorization",
	"headers.cookie",
	"*.password",
	"*.token",
	"*.accessToken",
	"*.refreshToken",
	"*.apiKey",
	"*.api_key",
	"*.authorization",
	"*.cookie",
];

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

export interface StructuredLogError {
	type: string;
	message: string;
	stack?: string;
}

export function serializeLogError(error: unknown): StructuredLogError {
	try {
		if (error instanceof Error) {
			return {
				type: error.name || "Error",
				message: error.message,
				...(typeof error.stack === "string" && error.stack ? { stack: error.stack } : {}),
			};
		}
	} catch {}
	return { type: "NonError", message: describeError(error) };
}

export function createPinoOptions(level: LogLevel): LoggerOptions {
	return {
		base: { schemaVersion: LOG_SCHEMA_VERSION },
		formatters: {
			level: (label, number) => ({ level: number, levelName: label }),
		},
		level,
		redact: { paths: SECRET_PATHS, remove: true },
		serializers: { err: (error: unknown) => error },
		timestamp: pino.stdTimeFunctions.isoTime,
	};
}

type PrettyOptions = NonNullable<Parameters<typeof pretty>[0]>;

export function createPrettyOptions(destination: PrettyOptions["destination"] = 2): PrettyOptions {
	return {
		colorize: false,
		destination,
		ignore: "pid,hostname,scope,levelName,schemaVersion",
		messageFormat: "[{scope}] {msg}",
		singleLine: true,
		sync: true,
		translateTime: "UTC:yyyy-mm-dd'T'HH:MM:ss.l'Z'",
	};
}

export function createPinoRollOptions(directory: string): PinoRollOptions {
	return {
		file: join(directory, "thinkrail.jsonl"),
		frequency: "daily",
		size: LOG_FILE_SIZE,
		dateFormat: "yyyy-MM-dd",
		limit: { count: LOG_TOTAL_FILES, removeOtherLogFiles: true },
		mkdir: true,
		sync: true,
	};
}

let currentLevel: LogLevel = "info";
let applicationLogger: PinoLogger | null = null;
let rollingStream: PinoRollStream | null = null;
let initialization: Promise<void> | null = null;

export function setLogLevel(level: LogLevel): void {
	currentLevel = level;
	if (applicationLogger) applicationLogger.level = level;
}

function writeDirectStderr(line: string): void {
	try {
		process.stderr.write(`${line}\n`);
	} catch {}
}

function fallbackLine(level: LogLevel, scope: string, message: string, error?: unknown): string {
	const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${message}`;
	if (error === undefined) return line;
	return `${line}\n${describeError(error)
		.split("\n")
		.map((part) => `  ${part}`)
		.join("\n")}`;
}

function writeWithPino(
	root: PinoLogger,
	level: LogLevel,
	scope: string,
	message: string,
	error?: unknown,
): void {
	const target = root.child({ scope });
	const method = target[level].bind(target);
	if (error === undefined) method(message);
	else method({ err: serializeLogError(error) }, message);
}

function emit(level: LogLevel, scope: string, message: string, error?: unknown): void {
	if (!shouldLog(level, currentLevel)) return;
	if (!applicationLogger) {
		writeDirectStderr(fallbackLine(level, scope, message, error));
		return;
	}
	try {
		writeWithPino(applicationLogger, level, scope, message, error);
	} catch {
		writeDirectStderr(fallbackLine(level, scope, message, error));
	}
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

function reportDestinationError(error: unknown): void {
	writeDirectStderr(fallbackLine("error", "log", "logging destination failed", error));
}

export async function cleanManagedLogs(directory: string): Promise<void> {
	await removeOldFiles({
		baseFile: join(directory, "thinkrail"),
		count: LOG_TOTAL_FILES,
		dateFormat: "yyyy-MM-dd",
		extension: "jsonl",
		removeOtherLogFiles: true,
	});
}

export function logsDir(): string {
	return join(dataDir(), "logs");
}

export interface InitLoggingOptions {
	level?: LogLevel;
	appVersion?: string;
}

async function initializeLogging(
	appVersion: string | undefined,
	invalidEnv: boolean,
): Promise<void> {
	try {
		rollingStream = await buildPinoRoll(createPinoRollOptions(logsDir()));
		rollingStream.on("error", reportDestinationError);
		try {
			await cleanManagedLogs(logsDir());
		} catch (error) {
			reportDestinationError(error);
		}
		const prettyStderr = pretty(createPrettyOptions());
		prettyStderr.on("error", reportDestinationError);
		applicationLogger = pino(
			createPinoOptions(currentLevel),
			pino.multistream([
				{ level: "debug", stream: prettyStderr },
				{ level: "debug", stream: rollingStream },
			]),
		);
	} catch (error) {
		reportDestinationError(error);
	}

	const log = logger("log");
	if (invalidEnv) {
		log.warn("THINKRAIL_LOG_LEVEL is not a level (debug|info|warn|error); using info");
	}
	log.info(
		`logging initialized (thinkrail ${appVersion ?? "source"}, pid ${process.pid}, level ${currentLevel})`,
	);
}

export async function initLogging(options: InitLoggingOptions = {}): Promise<void> {
	const { level, invalidEnv } = resolveLogLevel(options.level, process.env.THINKRAIL_LOG_LEVEL);
	setLogLevel(level);
	initialization ??= initializeLogging(options.appVersion, invalidEnv);
	await initialization;
}
