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
	return `[${at.toISOString()}] ${kind} (thinkrail ${build}, up ${Math.round(uptimeSeconds)}s)\n${describe(error)}\n\n`;
}

/**
 * What was thrown, as text that can always be produced.
 *
 * Anything can be thrown or rejected with, and every step of rendering an unknown value can itself throw:
 * `instanceof` and any property read trap on a revoked `Proxy`, `stack` may be an accessor that throws,
 * `JSON.stringify` rejects cycles and BigInts, and `String()` has neither `toString` nor a prototype to
 * borrow one from on a null-prototype object. A crash reporter that throws while reporting destroys the
 * very fault it exists to record — and it would throw from inside the handler, before anything reached
 * stderr or the file — so classification and every read sit inside the guard, degrading to the type alone.
 */
function describe(error: unknown): string {
	try {
		if (error instanceof Error) {
			// `stack` is typed `string | undefined` but is whatever the thrower left there; anything else
			// would only be coerced later, by the caller's interpolation, outside this guard.
			const { stack } = error;
			return typeof stack === "string" && stack ? stack : `${error.name}: ${error.message}`;
		}
		if (typeof error === "string") return `Non-Error thrown: ${error}`;
		return `Non-Error thrown: ${JSON.stringify(error) ?? String(error)}`;
	} catch {
		// Fall through: whatever this is, it resists the ordinary renderings.
	}
	try {
		return `Unrenderable throw: ${String(error)}`;
	} catch {
		// `typeof` is the one operator left that cannot trap.
		return `Unrenderable throw (${typeof error})`;
	}
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
