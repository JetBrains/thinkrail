const USER_PATH_MARKERS = ["/.nvm/", "/homebrew/", "/usr/local/bin", "/.bun/"];

export function pathLooksComplete(path: string): boolean {
	return USER_PATH_MARKERS.some((marker) => path.includes(marker));
}

function probeLoginShellPath(shell: string, interactive: boolean): string | null {
	const args = interactive ? ["-l", "-i", "-c", "env -0"] : ["-l", "-c", "env -0"];
	try {
		const result = Bun.spawnSync([shell, ...args], {
			timeout: 5000,
			stdout: "pipe",
			stderr: "ignore",
		});
		if (!result.success) return null;
		const text = new TextDecoder().decode(result.stdout);
		for (const entry of text.split("\0")) {
			const eq = entry.indexOf("=");
			if (eq !== -1 && entry.slice(0, eq) === "PATH") return entry.slice(eq + 1);
		}
		return null;
	} catch {
		return null;
	}
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

function resolvePath(): void {
	if (pathLooksComplete(process.env.PATH ?? "")) return;

	const shell = process.env.SHELL ?? "/bin/zsh";
	const path = probeLoginShellPath(shell, true) ?? probeLoginShellPath(shell, false);
	if (path) process.env.PATH = path;
}

export function resolveShellEnv(): void {
	if (process.platform === "win32") return;
	resolveLocale();
	resolvePath();
}
