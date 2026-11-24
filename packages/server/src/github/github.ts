import type { GhSetupProblem, GithubAuthStatus } from "@thinkrail/contracts";
import { runBounded } from "../subprocess";

const GH_PROBE_TIMEOUT_MS = 8_000;
const GH_STATUS = ["gh", "auth", "status", "--hostname", "github.com"];
const SIGNED_OUT: GithubAuthStatus = { connected: false };
const UNVERIFIED: GithubAuthStatus = { connected: false, unverified: true };

type GhAuthEntry = { state?: unknown; error?: unknown; login?: unknown; scopes?: unknown };

function runGh(argv: string[]) {
	return runBounded(argv, {
		timeoutMs: GH_PROBE_TIMEOUT_MS,
		env: { ...process.env, CLICOLOR_FORCE: "0", GH_FORCE_TTY: undefined },
	});
}

async function probeGhAuth(): Promise<GithubAuthStatus | "missing"> {
	const json = await runGh([...GH_STATUS, "--json", "hosts"]);
	if (json.launchFailed) return "missing";
	if (json.ok) return ghAuthFromJson(json.out);
	if (json.timedOut) return UNVERIFIED;
	return ghAuthFromText(await runGh(GH_STATUS));
}

export function ghAuthFromJson(out: string): GithubAuthStatus {
	let entries: unknown;
	try {
		entries = JSON.parse(out).hosts["github.com"];
	} catch {
		return UNVERIFIED;
	}
	if (entries === undefined) return SIGNED_OUT;
	const active: GhAuthEntry | undefined = Array.isArray(entries)
		? entries.find((entry) => entry?.active === true)
		: undefined;
	if (active?.state === "success") return signedIn(active.login, active.scopes);
	if (active?.state === "refresh_expired") return SIGNED_OUT;
	if (active?.state === "error" && String(active.error).startsWith("HTTP 401:")) return SIGNED_OUT;
	return UNVERIFIED;
}

export function ghAuthFromText(run: { ok: boolean; out: string; err: string }): GithubAuthStatus {
	const text = `${run.out}\n${run.err}`;
	const activeAccount = /Logged in to|Failed to log in to|Timeout trying to log in to/.exec(text);
	if (run.ok && activeAccount?.[0] === "Logged in to") return parseGhAuthStatus(text);
	return /not logged into any|not found among authenticated GitHub hosts/.test(text)
		? SIGNED_OUT
		: UNVERIFIED;
}

export function parseGhAuthStatus(text: string): GithubAuthStatus {
	return signedIn(
		/Logged in to \S+ (?:account |as )?([\w-]+)/.exec(text)?.[1],
		/Token scopes:\s*(.+)/.exec(text)?.[1],
	);
}

function signedIn(login: unknown, scopes: unknown): GithubAuthStatus {
	const status: GithubAuthStatus = { connected: true };
	if (typeof login === "string" && login) status.login = login;
	if (typeof scopes === "string") {
		const parsed = scopes
			.split(",")
			.map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
			.filter(Boolean);
		if (parsed.length > 0) status.scopes = parsed;
	}
	return status;
}

export async function githubAuthStatus(): Promise<GithubAuthStatus> {
	if (process.env.THINKRAIL_GH_OFFLINE === "1") return { connected: false };
	const auth = await probeGhAuth();
	return auth === "missing" ? SIGNED_OUT : auth;
}

export function githubRefresh(): Promise<GithubAuthStatus> {
	return githubAuthStatus();
}

export async function ghSetupProblem(): Promise<GhSetupProblem | null> {
	if (process.env.THINKRAIL_GH_OFFLINE === "1") return null;
	const auth = await probeGhAuth();
	if (auth === "missing") return "missing";
	return auth.connected || auth.unverified ? null : "unauthenticated";
}
