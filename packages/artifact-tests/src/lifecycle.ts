export interface PollUntilOptions {
	readonly timeoutMs: number;
	readonly what: string;
	readonly intervalMs?: number;
	readonly exited?: Promise<number>;
	readonly exitError?: (code: number) => Error | undefined;
}

export interface LaunchedProcess {
	readonly pid: number;
	readonly exited: Promise<number>;
	readonly exitCode: number | null;
}

export interface TerminateProcessOptions {
	readonly knownPids?: Iterable<number | undefined>;
	readonly timeoutMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_TERMINATION_TIMEOUT_MS = 5_000;

function timeoutError(ms: number, what: string): Error {
	return new Error(`timed out after ${ms}ms: ${what}`);
}

export async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(timeoutError(ms, what)), ms);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

export async function pollUntil(
	condition: () => boolean,
	options: PollUntilOptions,
): Promise<void> {
	if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) {
		throw new RangeError("pollUntil requires a finite non-negative timeout");
	}
	const deadline = performance.now() + options.timeoutMs;
	const intervalMs = Math.max(1, options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS);
	let observedExit: { code: number } | undefined;
	let polling = true;
	if (options.exited) {
		void options.exited.then(
			(code) => {
				if (polling) observedExit = { code };
			},
			() => {},
		);
	}

	try {
		while (true) {
			if (condition()) return;
			if (observedExit) {
				const error = options.exitError?.(observedExit.code);
				if (error) throw error;
			}
			const remainingMs = deadline - performance.now();
			if (remainingMs <= 0) throw timeoutError(options.timeoutMs, options.what);
			await Bun.sleep(Math.min(intervalMs, remainingMs));
		}
	} finally {
		polling = false;
	}
}

function validPid(pid: number | undefined): pid is number {
	return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid;
}

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return !(
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "ESRCH"
		);
	}
}

function remainingMs(deadline: number): number {
	return Math.max(1, Math.ceil(deadline - performance.now()));
}

function snapshotDescendants(rootPid: number, deadline: number): number[] {
	const result = Bun.spawnSync(["ps", "-axo", "pid=,ppid="], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		timeout: remainingMs(deadline),
		killSignal: "SIGKILL",
	});
	if (!result.success) {
		throw new Error(`could not snapshot descendants of process ${rootPid}`);
	}

	const childrenByParent = new Map<number, number[]>();
	for (const line of result.stdout.toString().split("\n")) {
		const match = line.trim().match(/^(\d+)\s+(\d+)$/);
		if (!match) continue;
		const pid = Number(match[1]);
		const parentPid = Number(match[2]);
		const children = childrenByParent.get(parentPid);
		if (children) children.push(pid);
		else childrenByParent.set(parentPid, [pid]);
	}

	const descendants: number[] = [];
	const pending = [...(childrenByParent.get(rootPid) ?? [])];
	while (pending.length > 0) {
		const pid = pending.pop();
		if (pid === undefined || !validPid(pid)) continue;
		descendants.push(pid);
		pending.push(...(childrenByParent.get(pid) ?? []));
	}
	return descendants;
}

function killPosixProcess(pid: number): void {
	try {
		process.kill(pid, "SIGKILL");
	} catch (error) {
		if (
			typeof error !== "object" ||
			error === null ||
			!("code" in error) ||
			error.code !== "ESRCH"
		) {
			throw error;
		}
	}
}

function taskkill(pid: number, deadline: number): void {
	const result = Bun.spawnSync(["taskkill.exe", "/PID", String(pid), "/T", "/F"], {
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
		timeout: remainingMs(deadline),
		killSignal: "SIGKILL",
	});
	if (!result.success && processAlive(pid)) {
		throw new Error(`taskkill could not terminate process tree ${pid}`);
	}
}

export async function reapProcess(
	launched: LaunchedProcess,
	options: TerminateProcessOptions = {},
): Promise<void> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TERMINATION_TIMEOUT_MS;
	if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
		throw new RangeError("terminateProcess requires a finite non-negative timeout");
	}
	const deadline = performance.now() + timeoutMs;
	const knownPids = [...new Set(options.knownPids ?? [])].filter(validPid);
	const launchedRootIsLive = launched.exitCode === null;
	const cleanupErrors: unknown[] = [];
	let descendants: number[] = [];
	if (launchedRootIsLive && process.platform !== "win32") {
		try {
			descendants = snapshotDescendants(launched.pid, deadline);
		} catch (error) {
			cleanupErrors.push(error);
		}
	}
	const targets = new Set<number>(knownPids);
	if (launchedRootIsLive) targets.add(launched.pid);
	for (const pid of descendants) targets.add(pid);

	if (process.platform === "win32") {
		if (launchedRootIsLive) {
			try {
				taskkill(launched.pid, deadline);
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		for (const pid of knownPids) {
			if (pid === launched.pid || !processAlive(pid)) continue;
			try {
				taskkill(pid, deadline);
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
	} else {
		for (const pid of targets) {
			try {
				killPosixProcess(pid);
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
	}

	try {
		await within(launched.exited, remainingMs(deadline), `process ${launched.pid} exit`);
	} catch (error) {
		cleanupErrors.push(error);
	}
	try {
		await pollUntil(() => [...targets].every((pid) => !processAlive(pid)), {
			timeoutMs: remainingMs(deadline),
			what: `process ${launched.pid} termination`,
		});
	} catch (error) {
		cleanupErrors.push(error);
	}
	if (cleanupErrors.length === 1) throw cleanupErrors[0];
	if (cleanupErrors.length > 1) {
		throw new AggregateError(cleanupErrors, `process ${launched.pid} cleanup failed`);
	}
}

function failureMessage(failure: unknown): string {
	return failure instanceof Error ? failure.message : String(failure);
}

export interface CleanupOutcome {
	readonly failed: boolean;
}

export interface RunWithCleanupOptions {
	readonly reportFailure?: (failure: unknown) => void;
}

export async function runWithCleanup<T>(
	work: () => Promise<T>,
	cleanups: readonly ((outcome: CleanupOutcome) => unknown)[],
	options: RunWithCleanupOptions = {},
): Promise<T> {
	let settled: { ok: true; value: T } | { ok: false; error: unknown };
	try {
		settled = { ok: true, value: await work() };
	} catch (error) {
		settled = { ok: false, error };
		(options.reportFailure ?? console.error)(error);
	}
	const cleanupErrors: unknown[] = [];
	for (const cleanup of cleanups) {
		try {
			await cleanup({ failed: !settled.ok });
		} catch (error) {
			cleanupErrors.push(error);
		}
	}
	if (cleanupErrors.length === 0) {
		if (settled.ok) return settled.value;
		throw settled.error;
	}
	const cleanupMessage = cleanupErrors.map(failureMessage).join("; ");
	if (!settled.ok) {
		throw new AggregateError(
			[settled.error, ...cleanupErrors],
			`${failureMessage(settled.error)}; cleanup also failed: ${cleanupMessage}`,
			{ cause: settled.error },
		);
	}
	if (cleanupErrors.length === 1) {
		throw new Error(`cleanup failed: ${cleanupMessage}`, { cause: cleanupErrors[0] });
	}
	throw new AggregateError(cleanupErrors, `cleanup failed: ${cleanupMessage}`);
}

export function processesUnderRoots(listing: string, roots: readonly string[]): number[] {
	const needles = [
		...new Set(roots.map((root) => root.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase())),
	].filter((root) => root.length > 0);
	const pids: number[] = [];
	for (const line of listing.split(/\r?\n/)) {
		const match = line.match(/^\s*(\d+)\t(.*)$/);
		if (!match) continue;
		const pid = Number(match[1]);
		const described = (match[2] ?? "").replaceAll("/", "\\").toLowerCase();
		if (validPid(pid) && needles.some((root) => containsPathUnder(described, root))) pids.push(pid);
	}
	return pids;
}

function containsPathUnder(described: string, root: string): boolean {
	for (let at = described.indexOf(root); at >= 0; at = described.indexOf(root, at + 1)) {
		const next = described.charAt(at + root.length);
		if (next === "" || /[\\\s"']/.test(next)) return true;
	}
	return false;
}

const WINDOWS_PROCESS_LISTING =
	"Get-CimInstance Win32_Process | ForEach-Object { @($_.ProcessId, $_.ExecutablePath, $_.CommandLine) -join [char]9 }";

export function windowsProcessesUnder(roots: readonly string[], timeoutMs = 15_000): number[] {
	const result = Bun.spawnSync(
		["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_PROCESS_LISTING],
		{
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			timeout: timeoutMs,
			killSignal: "SIGKILL",
		},
	);
	if (!result.success) {
		throw new Error(
			`could not list processes under ${roots.join(", ")}: powershell exited ${result.exitCode}: ${result.stderr.toString().trim()}`,
		);
	}
	return processesUnderRoots(result.stdout.toString(), roots);
}

export async function terminateProcess(
	launched: LaunchedProcess,
	failure: unknown,
	options: TerminateProcessOptions = {},
): Promise<never> {
	try {
		await reapProcess(launched, options);
	} catch (cleanupError) {
		throw new AggregateError(
			[failure, cleanupError],
			`${failureMessage(failure)}; process cleanup also failed`,
			{ cause: failure },
		);
	}
	throw failure;
}
