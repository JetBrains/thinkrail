import type { GhSetupProblem, GithubAuthStatus } from "@thinkrail/contracts";

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

export function ghSetupProblemFrom(ghPath: string | null, authOk: boolean): GhSetupProblem | null {
	if (ghPath === null) return "missing";
	return authOk ? null : "unauthenticated";
}

const GH_PROBE_TIMEOUT_MS = 8_000;

export async function ghSetupProblem(): Promise<GhSetupProblem | null> {
	if (process.env.THINKRAIL_GH_OFFLINE === "1") return null;
	const ghPath = Bun.which("gh");
	if (ghPath === null) return "missing";
	try {
		const proc = Bun.spawn(["gh", "auth", "status"], { stdout: "ignore", stderr: "ignore" });
		let timedOut = false;
		const term = setTimeout(() => {
			timedOut = true;
			proc.kill();
		}, GH_PROBE_TIMEOUT_MS);
		const kill = setTimeout(() => proc.kill(9), GH_PROBE_TIMEOUT_MS + 2_000);
		try {
			const exitCode = await proc.exited;
			if (timedOut) return null;
			return ghSetupProblemFrom(ghPath, exitCode === 0);
		} finally {
			clearTimeout(term);
			clearTimeout(kill);
		}
	} catch {
		return "missing";
	}
}
