import type { GithubAuthStatus } from "@thinkrail/contracts";

export function githubAuthStatus(): GithubAuthStatus {
	if (process.env.THINKRAIL_GH_OFFLINE === "1") return { connected: false };

	let result: { success: boolean; stdout: Uint8Array; stderr: Uint8Array };
	try {
		result = Bun.spawnSync(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
	} catch {
		return { connected: false };
	}
	if (!result.success) return { connected: false };

	return parseGhAuthStatus(
		`${new TextDecoder().decode(result.stdout)}\n${new TextDecoder().decode(result.stderr)}`,
	);
}

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

export function githubRefresh(): GithubAuthStatus {
	return githubAuthStatus();
}
