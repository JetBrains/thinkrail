import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CodedError } from "@thinkrail/shared/codedError";
import { gitAsync } from "../git";
import { SITE_MARKER_FILE, type SiteFile } from "./site";

const PUSH_TIMEOUT_MS = 120_000;
const LOCAL_TIMEOUT_MS = 20_000;
const COMMIT_IDENTITY = [
	"-c",
	"user.name=ThinkRail Wiki",
	"-c",
	"user.email=wiki@thinkrail.invalid",
	"-c",
	"commit.gpgsign=false",
];

function withoutCredentials(text: string): string {
	return text.replace(/(\w+:\/\/)[^/@\s]+@/g, "$1");
}

function failure(step: string, err: string): CodedError {
	const detail = withoutCredentials(err).trim();
	return new CodedError("WIKI_PUBLISH_FAILED", detail ? `${step}: ${detail}` : step);
}

/**
 * Replaces `branch` on `remoteUrl` with a one-commit tree of `files`. A branch that exists but was not
 * written by a previous publish (no marker file) is refused rather than overwritten.
 */
export async function pushSite(options: {
	files: readonly SiteFile[];
	remoteUrl: string;
	branch: string;
}): Promise<{ sha: string }> {
	const { files, remoteUrl, branch } = options;
	const dir = mkdtempSync(join(tmpdir(), "thinkrail-wiki-"));
	try {
		const run = async (args: string[], timeoutMs = LOCAL_TIMEOUT_MS) =>
			gitAsync(dir, args, { timeoutMs });

		const init = await run(["init", "-q"]);
		if (!init.ok) throw failure("git init", init.err);

		const remote = await run(
			["ls-remote", "--heads", remoteUrl, `refs/heads/${branch}`],
			PUSH_TIMEOUT_MS,
		);
		if (!remote.ok) throw failure("Could not reach the remote", remote.err);
		const checkedSha = remote.out.split(/\s/)[0] ?? "";
		if (checkedSha !== "") {
			const fetched = await run(
				["fetch", "-q", "--depth", "1", remoteUrl, `refs/heads/${branch}`],
				PUSH_TIMEOUT_MS,
			);
			if (!fetched.ok) throw failure("Could not read the existing branch", fetched.err);
			const owned = await run(["cat-file", "-e", `FETCH_HEAD:${SITE_MARKER_FILE}`]);
			if (!owned.ok) {
				throw new CodedError(
					"WIKI_BRANCH_FOREIGN",
					`Branch ${branch} already exists and was not published by ThinkRail`,
				);
			}
		}

		for (const file of files) {
			const target = join(dir, file.path);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, file.content);
		}

		const checkout = await run(["checkout", "-q", "-b", branch]);
		if (!checkout.ok) throw failure("git checkout", checkout.err);
		const add = await run(["add", "-A"]);
		if (!add.ok) throw failure("git add", add.err);
		const commit = await run([...COMMIT_IDENTITY, "commit", "-q", "-m", "Publish repo wiki"]);
		if (!commit.ok) throw failure("git commit", commit.err);
		const head = await run(["rev-parse", "HEAD"]);
		if (!head.ok) throw failure("git rev-parse", head.err);

		const push = await run(
			[
				"push",
				`--force-with-lease=refs/heads/${branch}:${checkedSha}`,
				remoteUrl,
				`HEAD:refs/heads/${branch}`,
			],
			PUSH_TIMEOUT_MS,
		);
		if (!push.ok) throw failure("git push", push.err);
		return { sha: head.out };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
