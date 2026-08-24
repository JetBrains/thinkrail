import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describeError } from "../log";
import { dataDir } from "../persistence";

export type CrashKind = "uncaughtException" | "unhandledRejection";

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
	return `[${at.toISOString()}] ${kind} (thinkrail ${build}, up ${Math.round(uptimeSeconds)}s)\n${describeError(error)}\n\n`;
}

let installed = false;

export function installCrashLog(appVersion?: string): void {
	if (installed || process.env.NODE_ENV === "test") return;
	installed = true;
	const report = (kind: CrashKind, error: unknown): never => {
		const record = formatCrashRecord(kind, error, new Date(), process.uptime(), appVersion);
		process.stderr.write(`\nthinkrail host: fatal ${kind}\n${record}`);
		try {
			const path = crashLogPath();
			mkdirSync(join(path, ".."), { recursive: true });
			appendFileSync(path, record);
			process.stderr.write(`thinkrail host: wrote crash report to ${path}\n`);
		} catch (writeError) {
			process.stderr.write(`thinkrail host: could not write the crash report: ${writeError}\n`);
		}
		process.exit(1);
	};
	process.on("uncaughtException", (error) => report("uncaughtException", error));
	process.on("unhandledRejection", (reason) => report("unhandledRejection", reason));
}
