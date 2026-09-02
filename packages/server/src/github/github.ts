import type { GhSetupProblem, GithubAuthStatus } from "@thinkrail/contracts";
import { runBounded } from "../subprocess";

const GH_PROBE_TIMEOUT_MS = 8_000;

export async function githubAuthStatus(): Promise<GithubAuthStatus> {
	if (process.env.THINKRAIL_GH_OFFLINE === "1") return { connected: false };

	const result = await runBounded(["gh", "auth", "status"], { timeoutMs: GH_PROBE_TIMEOUT_MS });
	if (!result.ok) return { connected: false };

	return parseGhAuthStatus(`${result.out}\n${result.err}`);
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

export function githubRefresh(): Promise<GithubAuthStatus> {
	return githubAuthStatus();
}

export function ghSetupProblemFrom(ghPath: string | null, authOk: boolean): GhSetupProblem | null {
	if (ghPath === null) return "missing";
	return authOk ? null : "unauthenticated";
}

export async function ghSetupProblem(): Promise<GhSetupProblem | null> {
	if (process.env.THINKRAIL_GH_OFFLINE === "1") return null;
	const ghPath = Bun.which("gh");
	if (ghPath === null) return "missing";
	const result = await runBounded(["gh", "auth", "status"], { timeoutMs: GH_PROBE_TIMEOUT_MS });
	if (result.timedOut) return null;
	if (result.launchFailed) return "missing";
	return ghSetupProblemFrom(ghPath, result.ok);
}
