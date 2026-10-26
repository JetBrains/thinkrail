import { delimiter } from "node:path";

const PROBE_BASE_PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const PROBE_TIMEOUT_MS = 5000;
const LAUNCHCTL_TIMEOUT_MS = 3000;
const ORPHAN_PIPE_GRACE_MS = 100;

export function mergePath(current: string, login: string): string {
	const loginEntries = login.split(delimiter).filter(Boolean);
	const known = new Set(loginEntries);
	const extras = current.split(delimiter).filter((entry) => entry && !known.has(entry));
	return [...extras, ...loginEntries].join(delimiter);
}

export const LOGIN_ENV_MARKER = "__THINKRAIL_LOGIN_ENV__";
export const LOGIN_ENV_END = "__THINKRAIL_LOGIN_ENV_END__";
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseLoginShellEnv(stdout: string): Map<string, string> | null {
	const start = stdout.lastIndexOf(LOGIN_ENV_MARKER);
	if (start === -1) return null;
	const end = stdout.indexOf(LOGIN_ENV_END, start);
	if (end === -1) return null;
	const env = new Map<string, string>();
	for (const entry of stdout.slice(start + LOGIN_ENV_MARKER.length, end).split("\0")) {
		const eq = entry.indexOf("=");
		if (eq <= 0) continue;
		const name = entry.slice(0, eq);
		if (ENV_NAME.test(name)) env.set(name, entry.slice(eq + 1));
	}
	return env.size > 0 ? env : null;
}

function killGroup(child: Bun.Subprocess): void {
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		child.kill("SIGKILL");
	}
}

async function readStdout(
	argv: string[],
	options: { timeout: number; env?: Record<string, string | undefined>; until?: string },
): Promise<string | null> {
	try {
		const child = Bun.spawn(argv, {
			...(options.env ? { env: options.env } : {}),
			detached: true,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "ignore",
		});
		const deadline = setTimeout(() => killGroup(child), options.timeout);
		const reader = child.stdout.getReader();
		const decoder = new TextDecoder();
		let text = "";
		let complete = false;
		const drained = (async () => {
			for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
				if (complete) continue;
				text += decoder.decode(chunk.value, { stream: true });
				complete = options.until !== undefined && text.includes(options.until);
			}
		})().catch(() => {});
		const code = await child.exited;
		clearTimeout(deadline);
		if (code === 0 && !complete) await Promise.race([drained, Bun.sleep(ORPHAN_PIPE_GRACE_MS)]);
		void reader.cancel().catch(() => {});
		return code === 0 ? text + decoder.decode() : null;
	} catch {
		return null;
	}
}

async function probeLoginShellEnv(
	shell: string,
	interactive: boolean,
	timeout: number,
): Promise<Map<string, string> | null> {
	const script = `printf '%s' '${LOGIN_ENV_MARKER}'; env -0 && printf '%s' '${LOGIN_ENV_END}'`;
	const args = interactive ? ["-l", "-i", "-c", script] : ["-l", "-c", script];
	const stdout = await readStdout([shell, ...args], {
		timeout,
		env: { ...process.env, PATH: PROBE_BASE_PATH, HISTFILE: "/dev/null", HISTSIZE: "0" },
		until: LOGIN_ENV_END,
	});
	return stdout === null ? null : parseLoginShellEnv(stdout);
}

export type LoginShellEnvProbe = () => Promise<Map<string, string> | null>;

export function loginShellProbe(timeout = PROBE_TIMEOUT_MS): LoginShellEnvProbe {
	return async () => {
		const shell = process.env.SHELL ?? "/bin/zsh";
		return (
			(await probeLoginShellEnv(shell, true, timeout)) ??
			(await probeLoginShellEnv(shell, false, timeout))
		);
	};
}

const NEVER_IMPORTED_PREFIXES = ["PI_", "THINKRAIL_"];
const NEVER_IMPORTED = new Set(["PATH", "PWD", "OLDPWD", "SHLVL", "_", "HISTFILE", "HISTSIZE"]);

export function loginShellImports(
	processEnv: Record<string, string | undefined>,
	loginEnv: ReadonlyMap<string, string>,
): Record<string, string> {
	const imports: Record<string, string> = {};
	for (const [name, value] of loginEnv) {
		if (processEnv[name] !== undefined) continue;
		if (NEVER_IMPORTED.has(name)) continue;
		if (NEVER_IMPORTED_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
		imports[name] = value;
	}
	return imports;
}

export function localeRepair(
	env: Record<string, string | undefined>,
	platform: string,
): string | null {
	if (env.LC_ALL || env.LC_CTYPE || env.LANG) return null;
	return platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8";
}

function resolveLocale(): void {
	const lang = localeRepair(process.env, process.platform);
	if (lang) process.env.LANG = lang;
}

function resolveLoginShellImports(loginEnv: Map<string, string> | null): void {
	if (process.env.TERM !== undefined || !loginEnv) return;
	Object.assign(process.env, loginShellImports(process.env, loginEnv));
}

function resolvePath(loginEnv: Map<string, string> | null): void {
	const login = loginEnv?.get("PATH");
	if (login) process.env.PATH = mergePath(process.env.PATH ?? "", login);
}

async function launchdSshAgentSock(): Promise<string | undefined> {
	if (process.env.SSH_AUTH_SOCK || process.platform !== "darwin") return undefined;
	const stdout = await readStdout(["launchctl", "getenv", "SSH_AUTH_SOCK"], {
		timeout: LAUNCHCTL_TIMEOUT_MS,
	});
	return stdout?.trim() || undefined;
}

export async function repairShellEnv(options: { probe?: LoginShellEnvProbe } = {}): Promise<void> {
	if (process.platform === "win32") return;
	const [loginEnv, sshAgentSock] = await Promise.all([
		(options.probe ?? loginShellProbe())(),
		launchdSshAgentSock(),
	]);
	resolveLoginShellImports(loginEnv);
	resolveLocale();
	resolvePath(loginEnv);
	if (sshAgentSock && !process.env.SSH_AUTH_SOCK) process.env.SSH_AUTH_SOCK = sshAgentSock;
}

const pendingKey = Symbol.for("thinkrail.shellEnv.pending");
const processState = globalThis as typeof globalThis & { [pendingKey]?: Promise<void> };

export function resolveShellEnv(): Promise<void> {
	processState[pendingKey] ??= repairShellEnv();
	return processState[pendingKey];
}
