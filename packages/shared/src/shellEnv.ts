import { delimiter } from "node:path";

const PROBE_BASE_PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

export function mergePath(current: string, login: string): string {
	const loginEntries = login.split(delimiter).filter(Boolean);
	const known = new Set(loginEntries);
	const extras = current.split(delimiter).filter((entry) => entry && !known.has(entry));
	return [...extras, ...loginEntries].join(delimiter);
}

export const LOGIN_ENV_MARKER = "__THINKRAIL_LOGIN_ENV__";
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseLoginShellEnv(stdout: string): Map<string, string> | null {
	const marker = stdout.lastIndexOf(LOGIN_ENV_MARKER);
	if (marker === -1) return null;
	const env = new Map<string, string>();
	for (const entry of stdout.slice(marker + LOGIN_ENV_MARKER.length).split("\0")) {
		const eq = entry.indexOf("=");
		if (eq <= 0) continue;
		const name = entry.slice(0, eq);
		if (ENV_NAME.test(name)) env.set(name, entry.slice(eq + 1));
	}
	return env.size > 0 ? env : null;
}

function probeLoginShellEnv(shell: string, interactive: boolean): Map<string, string> | null {
	const script = `printf '%s' '${LOGIN_ENV_MARKER}'; env -0`;
	const args = interactive ? ["-l", "-i", "-c", script] : ["-l", "-c", script];
	try {
		const result = Bun.spawnSync([shell, ...args], {
			env: { ...process.env, PATH: PROBE_BASE_PATH },
			timeout: 5000,
			stdout: "pipe",
			stderr: "ignore",
		});
		if (!result.success) return null;
		return parseLoginShellEnv(new TextDecoder().decode(result.stdout));
	} catch {
		return null;
	}
}

export type LoginShellEnvProbe = () => Map<string, string> | null;

function defaultLoginShellProbe(): Map<string, string> | null {
	const shell = process.env.SHELL ?? "/bin/zsh";
	return probeLoginShellEnv(shell, true) ?? probeLoginShellEnv(shell, false);
}

const NEVER_IMPORTED_PREFIXES = ["PI_", "THINKRAIL_"];
const NEVER_IMPORTED = new Set(["PATH", "PWD", "OLDPWD", "SHLVL", "_"]);

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

function resolveLoginShellImports(loginEnv: () => Map<string, string> | null): void {
	if (process.env.TERM !== undefined) return;
	const env = loginEnv();
	if (!env) return;
	Object.assign(process.env, loginShellImports(process.env, env));
}

function resolvePath(loginEnv: () => Map<string, string> | null): void {
	const login = loginEnv()?.get("PATH");
	if (login) process.env.PATH = mergePath(process.env.PATH ?? "", login);
}

function resolveSshAgentSock(): void {
	if (process.env.SSH_AUTH_SOCK || process.platform !== "darwin") return;
	try {
		const result = Bun.spawnSync(["launchctl", "getenv", "SSH_AUTH_SOCK"], {
			timeout: 3000,
			stdout: "pipe",
			stderr: "ignore",
		});
		const sock = new TextDecoder().decode(result.stdout).trim();
		if (result.success && sock) process.env.SSH_AUTH_SOCK = sock;
	} catch {}
}

export function resolveShellEnv(options: { probe?: LoginShellEnvProbe } = {}): void {
	if (process.platform === "win32") return;
	let probed: Map<string, string> | null | undefined;
	const loginEnv = () => {
		if (probed === undefined) probed = (options.probe ?? defaultLoginShellProbe)();
		return probed;
	};
	resolveLoginShellImports(loginEnv);
	resolveLocale();
	resolvePath(loginEnv);
	resolveSshAgentSock();
}
