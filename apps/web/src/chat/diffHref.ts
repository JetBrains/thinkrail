// The `thinkrail-diff:` link scheme that ties a TODO markdown doc (produced by `planMarkdown`) to a Monaco
// diff tab (opened by the doc viewer's link handler in `panels/markdownLinks`). One home for the format so
// the producer and the consumer can never drift. A link carries a scope + a worktree-relative path:
//   thinkrail-diff:<sha>:<encoded-path>  → open the file at the `commit:{sha}` scope (the done-time diff)
//   thinkrail-diff::<encoded-path>       → empty sha = the live branch scope (the path-list fallback)
// The path is `encodeURIComponent`-encoded so spaces/special chars never break the markdown link or the
// scheme's `:` delimiter (a sha has no `:`, so the first `:` after the scheme is the unambiguous split).
// (The scheme deliberately avoids a `tr-` prefix so it can't read as a `tr-*` typography class.)

const SCHEME = "thinkrail-diff:";

/** Build a diff href for a file at a commit scope (`sha`) or the branch-scope fallback (`sha = null`). */
export function buildDiffHref(sha: string | null, path: string): string {
	return `${SCHEME}${sha ?? ""}:${encodeURIComponent(path)}`;
}

/** Parse a `thinkrail-diff:` href back to its `{ sha, path }`, or `null` if it isn't one (or is malformed). */
export function parseDiffHref(
	href: string | undefined,
): { sha: string | null; path: string } | null {
	if (!href?.startsWith(SCHEME)) return null;
	const rest = href.slice(SCHEME.length);
	const i = rest.indexOf(":");
	if (i < 0) return null;
	const sha = rest.slice(0, i);
	const path = decodeURIComponent(rest.slice(i + 1));
	if (!path) return null;
	return { sha: sha || null, path };
}
