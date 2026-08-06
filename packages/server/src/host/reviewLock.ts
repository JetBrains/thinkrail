// Per-workspace serialization for everything that touches a review's state.
//
// A send is check → create → mark: read the workspace's drafts (and whether the review already has a
// session), `await createSession(…)`, then flip those drafts to `sent` and link them. That `await` is
// the only point in the review layer where an operation is not atomic against the event loop, and it
// is enough to break two different things:
//
//   • Another SEND observes the same "drafts, no session yet" state, spawns a second agent against the
//     one worktree, and its `markCommentsSent` overwrites the first's session links.
//   • Another MUTATION lands in the gap. A `review.close` is the worst case — the package goes out
//     for the old review while `markCommentsSent` re-creates a fresh empty one and links the chat to
//     *that*, leaving a review chat about comments no open review contains.
//
// So the lock covers review mutations too, not just sends: one queue per workspace, and a mutation
// issued during a send simply happens after it. The wait is bounded by session creation, never by the
// agent's turn: the package prompt is fired detached after the mark (see `fireReviewPrompt`).
// Different workspaces never wait on each other.
//
// Deliberately NOT serialized: `review.get` (its load → re-anchor → persist is one synchronous pass, so
// it is already atomic, and hydration must not queue behind a send). Two MUTATIONS also stay out — `reviews.resolveCommentFromAgent`
// (the agent-tool seam) and `reanchorWorkspace` (the fs-watch tee): both are fully synchronous, and
// every mutation re-reads the snapshot from disk before writing, so neither can lose a write. They may
// still run inside a send's gap, and that is harmless: neither removes a comment nor closes the review,
// so the ids the package quotes stay valid.

/** Per workspace: a promise that settles when the last queued operation finished (it never rejects). */
const chains = new Map<string, Promise<void>>();

/**
 * Run `operation` after every review operation already queued for this workspace, and return its own
 * result/rejection.
 */
export function withReviewLock<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
	const previous = chains.get(workspaceId) ?? Promise.resolve();
	const result = previous.then(operation);
	// The queue tracks *completion*, not outcome: a failed operation must release the lock, not poison
	// every later one (and this swallowing copy is what keeps a rejection the caller does handle from
	// also surfacing as an unhandled rejection here).
	const settled = result.then(
		() => {},
		() => {},
	);
	chains.set(workspaceId, settled);
	// Drop the entry once the queue has drained, so a long-lived host doesn't retain one per workspace.
	void settled.then(() => {
		if (chains.get(workspaceId) === settled) chains.delete(workspaceId);
	});
	return result;
}
