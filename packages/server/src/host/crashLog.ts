import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../persistence";

/** What killed the process — the two faults that reach a Bun process as a top-level event. */
export type CrashKind = "uncaughtException" | "unhandledRejection";

/** Where crash reports are appended, under the data dir so they sit beside the state they describe. */
export function crashLogPath(): string {
	return join(dataDir(), "logs", "crash.log");
}

/**
 * One crash report: when, what kind of fault, which build, how long the host had been up, and the stack.
 * Pure so the format is unit-testable — this text is the only account of a fault that leaves nothing else
 * behind, so it has to survive a stack-less throw (a string, a rejected non-Error) intact.
 */
export function formatCrashRecord(
	kind: CrashKind,
	error: unknown,
	at: Date,
	uptimeSeconds: number,
	appVersion?: string,
): string {
	const build = appVersion ?? "source";
	const detail =
		error instanceof Error
			? (error.stack ?? `${error.name}: ${error.message}`)
			: `Non-Error thrown: ${typeof error === "string" ? error : (JSON.stringify(error) ?? String(error))}`;
	return `[${at.toISOString()}] ${kind} (thinkrail ${build}, up ${Math.round(uptimeSeconds)}s)\n${detail}\n\n`;
}

let installed = false;

/**
 * Record a fatal fault before the process goes, then let it go.
 *
 * The host runs `pi` **in-process**, so a fatal agent/provider fault takes the whole thing down (see
 * `AGENTS.md`) — and until now it took the only account of itself with it: a launcher started from a GUI
 * or an `npx` shim has no terminal left to read, and `bun --watch` scrolls the stack away behind whatever
 * came next. A file under the data dir is what makes the next crash answerable.
 *
 * Deliberately **not** a recovery: an uncaught fault leaves the process in an unknown state, and Bun's own
 * default is to exit, so this exits too (code 1) rather than keeping a half-broken host serving. Because
 * installing a handler suppresses Bun's own report, the stack is echoed to stderr as well — the terminal
 * must not get *less* than before.
 *
 * Skipped under `NODE_ENV=test` (which `bun test` sets, the same fact `analytics/mute.ts` reads for its own
 * reason): unit tests boot hosts in the runner's own process, and handing that process a handler that
 * exits would take the suite down instead of letting bun test report the fault.
 */
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
			// The report is the fallback for everything else; nothing is left to fall back to but stderr.
			process.stderr.write(`thinkrail host: could not write the crash report: ${writeError}\n`);
		}
		process.exit(1);
	};
	process.on("uncaughtException", (error) => report("uncaughtException", error));
	process.on("unhandledRejection", (reason) => report("unhandledRejection", reason));
}
