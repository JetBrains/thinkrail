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

	// `ls-remote`'s pattern matching is suffix-based, not exact: a bare pattern `main` also matches
	// `refs/heads/feature/main` (verified directly — a remote holding both `main` and `feature/main`
	// returns both rows for a `main` pattern). Filtering the parsed result down to exactly the requested
	// names keeps `heads`'s key set equal to what was asked for, so a caller iterating `Object.keys(heads)`
	// never sees a ref it didn't request.
	const requested = new Set(refs);
	const heads: Record<string, string> = {};
	for (const line of result.out.split("\n")) {
		if (!line) continue;
		const [sha, ref] = line.split("\t");
		if (!sha || !ref) continue;
		const name = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
		if (!requested.has(name)) continue;
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

/**
 * SSH's "scp-like" syntax, `[user@]host.xz:path` — the `user@` prefix is OPTIONAL in git's own rule
 * (confirmed directly: `git fetch` against a bare `buildserver.internal:org/repo.git` remote shells out to
 * `ssh buildserver.internal git-upload-pack ...`), so this does NOT require an `@`. Recognised whenever
 * there is no `://` scheme and no slash before the first colon — a `/`-then-`:` shape is a local path.
 * This over-matches some local paths that happen to contain a colon before any slash (e.g. a relative
 * `foo:bar` — which is exactly why git itself tells users to write `./foo:bar` to disambiguate), and that
 * is the deliberately-safe direction here: under-matching would background-probe an SSH remote the caller
 * meant to skip, which is the one failure this classification exists to prevent; over-matching only costs
 * an extra skipped probe on a rare, oddly-named local path.
 */
function isScpLikeSshUrl(url: string): boolean {
	if (url.includes("://")) return false;
	const colon = url.indexOf(":");
	if (colon === -1) return false;
	const slash = url.indexOf("/");
	return slash === -1 || slash > colon;
}

/**
 * Classify a remote's URL for the SSH-agent safety ladder (see {@link sshAgentPresent}): `"ssh"` for
 * `ssh://…` or any scp-like form (`git@host:path`, `user@host:path`, or a bare `host:path` with no user
 * at all — the `user@` prefix is optional in git's own rule), `"other"` for anything else this repo can
 * resolve a URL for, `"unknown"` when the remote doesn't exist or its URL can't be read. A missed SSH form
 * here means the app would background-probe an SSH remote it meant to skip — the one failure this
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
 * The plain macOS launchd default socket's trailing path segment, matched independent of its root
 * directory: it has been seen at both `/private/tmp/com.apple.launchd.<token>/Listeners` and
 * `/var/run/com.apple.launchd.<token>/Listeners` across macOS versions/session types — the inconsistency
 * between those two roots is itself the reason this matches the *segment*, never a fixed prefix. `<token>`
 * is a launchd-generated random id, minted per login session; nothing user-run organically produces a
 * directory named `com.apple.launchd.<token>` with a leaf literally named `Listeners`, so this cannot
 * plausibly exclude a genuine user-loaded agent.
 */
const LAUNCHD_DEFAULT_SOCKET = /\/com\.apple\.launchd\.[^/]+\/Listeners$/;

/**
 * Whether an external ssh-agent might be listening. Takes the socket path explicitly (defaulting to
 * `process.env.SSH_AUTH_SOCK` so every real call site is unchanged) so the launchd cases below are
 * testable with plain strings instead of mutating global env.
 *
 * `true` for any non-empty value — **except** the plain macOS launchd default socket
 * ({@link LAUNCHD_DEFAULT_SOCKET}), which is carved out and answers `false`. That default is set on
 * nearly every Mac whether or not the user has ever loaded a key into it; treating its mere presence as
 * "an agent is present" made every SSH remote look agent-guarded on virtually every Mac, which — for a
 * later caller that marks SSH remotes dormant when an agent might be listening — meant SSH remotes never
 * got probed on this Mac-first product's most common environment. That failure (a background check that
 * silently never runs) is worse than the risk this carve-out re-admits: the launchd socket is Apple's
 * Secure Keychain agent, which only prompts (Touch ID/Keychain) when a key has actually been loaded into
 * it via `ssh-add --apple-use-keychain` — the common case is no loaded key and no prompt at all. A
 * launchd-*shaped* path whose leaf isn't literally `Listeners` is not carved out: only the exact default
 * shape is excluded, not the whole `com.apple.launchd.*` prefix.
 */
export function sshAgentPresent(sock: string | undefined = process.env.SSH_AUTH_SOCK): boolean {
	if (sock === undefined || sock === "") return false;
	return !LAUNCHD_DEFAULT_SOCKET.test(sock);
}
