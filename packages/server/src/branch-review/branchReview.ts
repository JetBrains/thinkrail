import type { OpenBranchReview } from "@thinkrail/contracts";
import { git, nonInteractiveGitEnv } from "../git";
import { runBounded } from "../subprocess";

const LOOKUP_TIMEOUT_MS = 8_000;

type ReviewProvider = "github" | "gitlab";
type CommandResult = { ok: boolean; out: string };
type CommandRunner = (cwd: string, command: string[]) => Promise<CommandResult>;

export function detectReviewProvider(cwd: string, branch: string): ReviewProvider | null {
	const configured = [
		git(cwd, ["config", "--get", `branch.${branch}.pushRemote`]).out,
		git(cwd, ["config", "--get", "remote.pushDefault"]).out,
		git(cwd, ["config", "--get", `branch.${branch}.remote`]).out,
	];
	const listed = git(cwd, ["remote"]);
	const names = [
		...new Set([...configured, "origin", ...(listed.ok ? listed.out.split("\n") : [])]),
	];

	for (const name of names) {
		if (!name || name === ".") continue;
		for (const args of [
			["remote", "get-url", "--push", name],
			["remote", "get-url", name],
		]) {
			const remote = git(cwd, args);
			if (!remote.ok) continue;
			const provider = providerFromRemoteUrl(remote.out);
			if (provider) return provider;
		}
	}
	return null;
}

export function providerFromRemoteUrl(remoteUrl: string): ReviewProvider | null {
	const host = remoteHost(remoteUrl);
	if (host === "github.com") return "github";
	if (host === "gitlab.com") return "gitlab";
	return null;
}

function remoteHost(remoteUrl: string): string | null {
	try {
		const host = new URL(remoteUrl).hostname;
		if (host) return host.toLowerCase();
	} catch {}
	return /^(?:[^@/:\s]+@)?([^/:\s]+):/.exec(remoteUrl)?.[1]?.toLowerCase() ?? null;
}

export function findOpenBranchReview(
	cwd: string,
	branch: string,
): Promise<OpenBranchReview | null> {
	return findOpenBranchReviewWithRunner(cwd, branch, runCommand);
}

export async function findOpenBranchReviewWithRunner(
	cwd: string,
	branch: string,
	run: CommandRunner,
): Promise<OpenBranchReview | null> {
	try {
		const provider = detectReviewProvider(cwd, branch);
		if (!provider) return null;

		const command =
			provider === "github"
				? [
						"gh",
						"pr",
						"list",
						"--head",
						branch,
						"--state",
						"open",
						"--json",
						"number",
						"--limit",
						"1",
					]
				: ["glab", "mr", "list", "--source-branch", branch, "--output", "json", "--per-page", "1"];
		const result = await run(cwd, command);
		if (!result.ok) return null;

		const number = reviewNumber(result.out, provider === "github" ? "number" : "iid");
		if (number === null) return null;
		return { kind: provider === "github" ? "pull-request" : "merge-request", number };
	} catch {
		return null;
	}
}

export function reviewNumber(output: string, field: "number" | "iid"): number | null {
	try {
		const rows: unknown = JSON.parse(output);
		if (!Array.isArray(rows) || rows.length === 0) return null;
		const first: unknown = rows[0];
		if (typeof first !== "object" || first === null) return null;
		const value = (first as Record<string, unknown>)[field];
		return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
	} catch {
		return null;
	}
}

async function runCommand(cwd: string, command: string[]): Promise<CommandResult> {
	const run = await runBounded(command, {
		cwd,
		timeoutMs: LOOKUP_TIMEOUT_MS,
		env: {
			...nonInteractiveGitEnv(),
			GH_PROMPT_DISABLED: "1",
			GLAB_PROMPT_DISABLED: "1",
			NO_COLOR: "1",
		},
	});
	return { ok: run.ok, out: run.out.trim() };
}
