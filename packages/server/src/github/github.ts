import type { GithubAuthStatus } from "@thinkrail/contracts";

/**
 * Read-only local `gh` auth status by shelling `gh auth status` on the host's resolved PATH (login PATH is
 * resolved at boot via `resolveShellEnv`). Never bundled — this is server-only. Degrades gracefully: a
 * missing/un-authed `gh` returns `{ connected: false }` so the New-Workspace dialog still works offline.
 *
 * `THINKRAIL_GH_OFFLINE=1` forces the disconnected result without shelling out — e2e uses it to drive
 * the offline/degrade path deterministically regardless of the dev machine's real `gh` state.
 */
export function githubAuthStatus(): GithubAuthStatus {
	if (process.env.THINKRAIL_GH_OFFLINE === "1") return { connected: false };

	let result: { success: boolean; stdout: Uint8Array; stderr: Uint8Array };
	try {
		// `gh auth status` writes its human-readable report to stderr and exits non-zero when not logged in.
		result = Bun.spawnSync(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
	} catch {
		return { connected: false }; // `gh` not installed / not on PATH
	}
	if (!result.success) return { connected: false };

	return parseGhAuthStatus(
		`${new TextDecoder().decode(result.stdout)}\n${new TextDecoder().decode(result.stderr)}`,
	);
}

/** Parse a connected `gh auth status` report into the wire status (account + token scopes). Pure. */
export function parseGhAuthStatus(text: string): GithubAuthStatus {
	const status: GithubAuthStatus = { connected: true };
	const login = /Logged in to \S+ (?:account |as )?([\w-]+)/.exec(text)?.[1];
	if (login) status.login = login;
	const scopes = /Token scopes:\s*(.+)/.exec(text)?.[1];
	if (scopes) {
		const parsed = scopes
			.split(",")
			.map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
			.filter(Boolean);
		if (parsed.length > 0) status.scopes = parsed;
	}
	return status;
}

/** Re-check `gh` auth (the dialog's Refresh). Identical to `githubAuthStatus` — re-shells each call. */
export function githubRefresh(): GithubAuthStatus {
	return githubAuthStatus();
}
