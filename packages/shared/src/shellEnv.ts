// Ensure the host process has the user's full login PATH. A GUI-launched (Finder/Dock) process inherits
// a minimal PATH, so the in-process agent's bash/tools wouldn't find git/node/etc. Call once at startup,
// before creating any AgentSession.

const USER_PATH_MARKERS = ["/.nvm/", "/homebrew/", "/usr/local/bin", "/.bun/"];

/** True if PATH already looks like a full login PATH, so we can skip probing a shell. */
export function pathLooksComplete(path: string): boolean {
	return USER_PATH_MARKERS.some((marker) => path.includes(marker));
}

/** Probe a login shell for its PATH. Returns null on failure (so the caller leaves PATH untouched). */
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

export function resolveShellEnv(): void {
	if (process.platform === "win32") return;
	if (pathLooksComplete(process.env.PATH ?? "")) return;

	const shell = process.env.SHELL ?? "/bin/zsh";
	const path = probeLoginShellPath(shell, true) ?? probeLoginShellPath(shell, false);
	if (path) process.env.PATH = path;
}
