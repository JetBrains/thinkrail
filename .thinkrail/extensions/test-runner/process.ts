import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { parseConsole } from "./console";
import { isStructured, planArgs, type Runner } from "./detect";
import { parseJunit, type Report } from "./junit";
import { type Outcome, RESULT_OUTPUT_CHARS, type RunBy, type RunResult, tail } from "./model";

const RUN_TIMEOUT_MS = 10 * 60_000;
const KILL_GRACE_MS = 3_000;
const LIVE_OUTPUT_CHARS = 256 * 1024;
const MAX_REPORT_BYTES = 20 * 1024 * 1024;

const bunBinary = () =>
	process.versions.bun && basename(process.execPath).startsWith("bun") ? process.execPath : "bun";

const runEnv = (bun: string) => ({
	...process.env,
	PATH:
		bun === "bun"
			? process.env.PATH
			: [dirname(bun), process.env.PATH].filter(Boolean).join(delimiter),
	CI: "1",
	NO_COLOR: "1",
	FORCE_COLOR: "0",
});

export interface RunRequest {
	path: string;
	runner: Runner;
	filters: readonly string[];
	command: string;
	by: RunBy;
	signal: AbortSignal;
	onLine?: (line: string) => void;
}

interface Exit {
	code: number | null;
	spawnError?: string;
}

const killGroup = (pid: number | undefined, signal: NodeJS.Signals) => {
	if (!pid) return;
	try {
		process.kill(-pid, signal);
	} catch {
		try {
			process.kill(pid, signal);
		} catch {}
	}
};

const readReport = async (file: string): Promise<Report | undefined> => {
	if (!existsSync(file) || statSync(file).size > MAX_REPORT_BYTES) return undefined;
	try {
		return parseJunit(await readFile(file, "utf8"));
	} catch {
		return undefined;
	}
};

const outcomeOf = (stop: "cancelled" | "timeout" | undefined, exit: Exit, report: Report) => {
	if (stop) return stop;
	if (exit.spawnError) return "error";
	if (report.failuresTotal > 0) return "failed";
	return exit.code === 0 ? "passed" : "error";
};

const lastLineOf = (text: string) => {
	const lines = text.trimEnd().split("\n");
	return lines[lines.length - 1]?.trim() ?? "";
};

export const runTests = async (request: RunRequest): Promise<RunResult> => {
	const { path, runner, filters, command, by, signal, onLine } = request;
	const startedAt = Date.now();
	const reportFile = join(tmpdir(), `thinkrail-tests-${randomUUID()}.xml`);
	let output = "";
	let stop: "cancelled" | "timeout" | undefined;
	const exit = await new Promise<Exit>((resolve) => {
		if (!existsSync(path)) {
			resolve({ code: null, spawnError: `${path} does not exist.` });
			return;
		}
		if (signal.aborted) {
			stop = "cancelled";
			resolve({ code: null });
			return;
		}
		const bun = bunBinary();
		const child = spawn(bun, planArgs(runner, filters, reportFile), {
			cwd: path,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
			env: runEnv(bun),
		});
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const terminate = (reason: "cancelled" | "timeout") => {
			if (stop) return;
			stop = reason;
			killGroup(child.pid, "SIGTERM");
			killTimer = setTimeout(() => killGroup(child.pid, "SIGKILL"), KILL_GRACE_MS);
		};
		const timer = setTimeout(() => terminate("timeout"), RUN_TIMEOUT_MS);
		const onAbort = () => terminate("cancelled");
		signal.addEventListener("abort", onAbort, { once: true });
		const collect = (chunk: string) => {
			output = tail(output + chunk, LIVE_OUTPUT_CHARS);
			const line = lastLineOf(output);
			if (line) onLine?.(line);
		};
		child.stdout.setEncoding("utf8").on("data", collect);
		child.stderr.setEncoding("utf8").on("data", collect);
		const finish = (result: Exit) => {
			clearTimeout(timer);
			if (killTimer) clearTimeout(killTimer);
			signal.removeEventListener("abort", onAbort);
			resolve(result);
		};
		child.on("error", (error: NodeJS.ErrnoException) =>
			finish({
				code: null,
				spawnError:
					error.code === "ENOENT" ? "bun was not found on PATH." : `spawn failed: ${error.message}`,
			}),
		);
		child.on("close", (code) => finish({ code }));
	});
	const structured = isStructured(runner) ? await readReport(reportFile) : undefined;
	rmSync(reportFile, { force: true });
	const report = structured ?? parseConsole(output);
	const outcome: Outcome = outcomeOf(stop, exit, report);
	const message =
		exit.spawnError ??
		(stop === "timeout" ? `Stopped after ${Math.round(RUN_TIMEOUT_MS / 1000)}s.` : undefined);
	return {
		command,
		...(filters.length > 0 ? { filter: filters.join(" ") } : {}),
		by,
		startedAt,
		durationMs: Date.now() - startedAt,
		outcome,
		exitCode: exit.code,
		source: structured ? "junit" : "console",
		counts: report.counts,
		failures: report.failures,
		failuresTotal: report.failuresTotal,
		output: tail(output.trimEnd(), RESULT_OUTPUT_CHARS),
		...(message ? { message } : {}),
	};
};
