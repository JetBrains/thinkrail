// Make the host process's environment safe for the shells it spawns. A GUI-launched host (Finder/Dock,
// launchd, a systemd unit, a container) inherits a stripped-down environment: a minimal PATH, so the
// in-process agent's bash/tools wouldn't find git/node/etc., and often no locale at all, which leaves every
// shell byte-oriented instead of character-oriented. Call once at startup, before creating any AgentSession.

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

/**
 * The `LANG` to install for a host environment, or `null` to leave the locale alone. Pure, so it is the
 * testable seam for this rule (the same role `pathLooksComplete` plays for PATH).
 *
 * A shell with no locale is **byte**-oriented rather than character-oriented: readline deletes a single
 * *byte* per backspace, so over a two-byte character (Cyrillic, an umlaut, CJK) it leaves half a character on
 * screen and desyncs the line from what the shell believes it holds. Pure-ASCII use never reveals it.
 *
 * Only `LANG` is ever returned, and only when nothing at all is configured — setting `LC_ALL` would override
 * a user's per-category settings (`LC_NUMERIC`, `LC_TIME`, …). An explicit `LANG=C` is deliberately left
 * alone: it carries the same byte-oriented consequence, but it is a choice we don't get to overrule.
 *
 * `C.UTF-8` does not exist on macOS, where `en_US.UTF-8` is always present; on Linux `C.UTF-8` is the safer
 * pick because it exists on modern glibc *and* in minimal container images that generate no `en_US`. If the
 * name doesn't resolve, libc falls back to the C locale — exactly today's behaviour — so a wrong guess is
 * never worse than not trying.
 */
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

/** Replace `PATH` with the user's full login PATH, unless it already looks complete. */
function resolvePath(): void {
	if (pathLooksComplete(process.env.PATH ?? "")) return;

	const shell = process.env.SHELL ?? "/bin/zsh";
	const path = probeLoginShellPath(shell, true) ?? probeLoginShellPath(shell, false);
	if (path) process.env.PATH = path;
}

export function resolveShellEnv(): void {
	if (process.platform === "win32") return;
	// Two independent repairs: an incomplete PATH and a missing locale are unrelated failures, so the PATH
	// short-circuit must not skip the locale one.
	resolveLocale();
	resolvePath();
}
