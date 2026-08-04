import { git, gitAsync, REMOTE_ENV } from "./gitExec";

/**
 * `-c` overrides applied ahead of every remote subcommand, so a background fetch cannot trigger a
 * background repack/gc on the user's machine (a `fetch` that brought in a lot of objects can otherwise
 * decide, on its own, that now is a good time to `gc`).
 */
const NO_AUTO_MAINTENANCE = ["-c", "maintenance.auto=false", "-c", "gc.auto=0"];

/**
 * The argv `probeRemoteRefs` hands to `gitAsync` (after `-C <cwd> --no-optional-locks`, which `gitArgv`
 * itself prepends) — extracted and exported for the same reason `gitArgv`/`changedFileArgs` are: the exact
 * flag set is assertable without spawning. `--end-of-options` sits ahead of `remote` and `refs` because both
 * are repo/caller-controlled (a remote literally named `--upload-pack=…`, a branch that looks like a flag);
 * `ls-remote` takes no pathspecs, so there is no trailing `--` to add.
 */
export function probeRemoteRefsArgv(remote: string, refs: string[]): string[] {
	return [...NO_AUTO_MAINTENANCE, "ls-remote", "--heads", "--end-of-options", remote, ...refs];
}

/**
 * `git ls-remote --heads <remote> <refs…>` — the write-nothing probe. No objects are fetched, no ref
 * (local *or* remote-tracking) is written, no `.git/FETCH_HEAD`, no ref lock, no gc trigger: this is
 * exactly `ls-remote`'s contract, verified empirically (see the test file) against `.git/FETCH_HEAD` and a
 * `for-each-ref refs/remotes` snapshot. It answers only *whether* a ref differs from what this repo has —
 * never by how much, because the objects behind a moved ref are never made local by this call. `refs` are
 * passed as **patterns**, so the remote does the filtering server-side (protocol v2) rather than this
 * repo fetching every head and throwing most of it away.
 *
 * A failed read answers `{ ok: false, heads: {}, err }` — the stderr, never swallowed into an
 * empty-but-successful-looking result (an unreachable remote and an up-to-date one must never look alike).
 */
export async function probeRemoteRefs(
	repoPath: string,
	remote: string,
	refs: string[],
	timeoutMs: number,
): Promise<{ ok: boolean; heads: Record<string, string>; err: string }> {
	const result = await gitAsync(repoPath, probeRemoteRefsArgv(remote, refs), {
		env: REMOTE_ENV,
		timeoutMs,
	});
	if (!result.ok) return { ok: false, heads: {}, err: result.err || "git ls-remote failed" };

	const heads: Record<string, string> = {};
	for (const line of result.out.split("\n")) {
		if (!line) continue;
		const [sha, ref] = line.split("\t");
		if (!sha || !ref) continue;
		const name = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
		heads[name] = sha;
	}
	return { ok: true, heads, err: "" };
}

/** `refs/remotes/<remote>/<name>`, resolved and existence-checked. See {@link fetchRemoteRefs}'s docstring for why fully qualified. */
function trackingRefOid(repoPath: string, remote: string, name: string): string | undefined {
	const result = git(repoPath, [
		"rev-parse",
		"--verify",
		"--quiet",
		"--end-of-options",
		`refs/remotes/${remote}/${name}`,
	]);
	return result.ok && result.out !== "" ? result.out : undefined;
}

/**
 * The argv `fetchRemoteRefs` hands to `gitAsync` — see {@link probeRemoteRefsArgv} for why this is
 * extracted and exported. **Never contains `--prune`** (would delete a remote-tracking ref some workspace
 * is pinned to, outside the explicit refs this call names) or **`--tags`** (this module has no use for
 * tags, and default `fetch` already auto-follows a tag reachable from what it fetches without adding either
 * flag) — both omissions are load-bearing enough to assert on this array directly rather than trust a
 * behavioral side effect, since a fetch that only ever names explicit refs gives `--prune` no observable
 * scope to bite in most shapes, which would make a purely behavioral test of its *absence* too easy to
 * pass for the wrong reason.
 */
export function fetchRemoteRefsArgv(remote: string, refs: string[]): string[] {
	return [...NO_AUTO_MAINTENANCE, "fetch", "--end-of-options", remote, ...refs];
}

/**
 * The opt-in real fetch — the only one of the two remote calls this module makes that is allowed to write.
 * Reads each requested ref's **fully-qualified** `refs/remotes/<remote>/<name>` before and after (never the
 * short name `<remote>/<name>`): a local branch literally named `origin/<b>` sits earlier in git's DWIM
 * resolution order and would shadow the remote-tracking ref, making a real move invisible — the identical
 * hazard `prefetchBranch` (`git.ts`) documents and guards against the same way. `moved` lists the refs
 * whose oid changed, a ref's first appearance included.
 */
export async function fetchRemoteRefs(
	repoPath: string,
	remote: string,
	refs: string[],
	timeoutMs: number,
): Promise<{ ok: boolean; moved: string[]; err: string }> {
	const before = new Map(refs.map((name) => [name, trackingRefOid(repoPath, remote, name)]));

	const result = await gitAsync(repoPath, fetchRemoteRefsArgv(remote, refs), {
		env: REMOTE_ENV,
		timeoutMs,
	});
	if (!result.ok) return { ok: false, moved: [], err: result.err || "git fetch failed" };

	const moved = refs.filter((name) => {
		const after = trackingRefOid(repoPath, remote, name);
		return after !== undefined && after !== before.get(name);
	});
	return { ok: true, moved, err: "" };
}

/**
 * `git rev-list --count from..to`, purely local — no network, no remote call. Answers `null`, never `0`,
 * when the range fails to resolve (a ref that doesn't exist locally — exactly the state a probe alone
 * leaves the caller in, since it never makes the remote's objects local). An unknown count is not "up to
 * date": the UI renders the two differently (a bare `↓` vs `↓·N`), so collapsing this to `0` would falsify
 * that distinction two layers up. `--end-of-options` guards the range expression itself, since a caller
 * value starting with `-` would otherwise make the concatenated `from..to` string look like a flag.
 */
export function behindCount(repoPath: string, from: string, to: string): number | null {
	const result = git(repoPath, ["rev-list", "--count", "--end-of-options", `${from}..${to}`]);
	if (!result.ok) return null;
	const count = Number(result.out);
	return Number.isFinite(count) ? count : null;
}

/** SSH's "scp-like" syntax (`[user@]host.xz:path`) — recognised only when there is no `://` scheme and no
 * slash before the first colon (a `/`-then-`:` shape is a local path, e.g. a Windows-style one is excluded
 * by the `@` requirement below). Both `git@host:path` and `user@host:path` share this one shape. */
function isScpLikeSshUrl(url: string): boolean {
	if (url.includes("://")) return false;
	const colon = url.indexOf(":");
	if (colon === -1) return false;
	const slash = url.indexOf("/");
	if (slash !== -1 && slash < colon) return false;
	return url.slice(0, colon).includes("@");
}

/**
 * Classify a remote's URL for the SSH-agent safety ladder (see {@link sshAgentPresent}): `"ssh"` for
 * `ssh://…` or either SCP-like form (`git@host:path`, `user@host:path`), `"other"` for anything else this
 * repo can resolve a URL for, `"unknown"` when the remote doesn't exist or its URL can't be read. A missed
 * SSH form here means the app would background-probe an SSH remote it meant to skip — the one failure this
 * classification exists to prevent — so it stays a static, empirically-checked shape test rather than
 * anything that could silently narrow.
 */
export function remoteUrlKind(repoPath: string, remote: string): "ssh" | "other" | "unknown" {
	const result = git(repoPath, ["remote", "get-url", "--end-of-options", remote]);
	if (!result.ok || !result.out) return "unknown";
	if (/^ssh:\/\//i.test(result.out)) return "ssh";
	if (isScpLikeSshUrl(result.out)) return "ssh";
	return "other";
}

/**
 * Whether an external ssh-agent might be listening — `SSH_AUTH_SOCK` set to a non-empty value. Deliberately
 * **not** special-cased for the plain macOS launchd socket (`/private/tmp/com.apple.launchd.<id>/Listeners`,
 * set by default on nearly every Mac): that socket is a real, protocol-compliant agent — Apple's Secure
 * Keychain agent — that can hold keys added via `ssh-add --apple-use-keychain` and answer agent requests, so
 * treating its mere presence as "no agent" would invert the safety direction this check exists for. The
 * conservative failure mode is "assume an agent might be listening, skip the background op": a background
 * probe refusing to run on a machine that turns out to have no loaded key is a convenience cost, while a
 * silent Keychain/Touch ID prompt surfacing during an unattended background call is exactly the failure
 * `REMOTE_ENV` cannot prevent on its own (it closes every *git-level* prompt path, not what sits below git)
 * and this function exists to let a caller refuse instead.
 */
export function sshAgentPresent(): boolean {
	const sock = process.env.SSH_AUTH_SOCK;
	return sock !== undefined && sock !== "";
}
