import { useCallback, useEffect, useRef } from "react";
import { selectWorkspaceTick, useAppStore } from "../store";

/** What a caller does with each outcome of the read; the hook owns *when*, these own *what*. */
interface WorkspaceReadHandlers<T> {
	/** A landed read (never called for a response the hook has since abandoned). */
	onResult: (value: T, workspaceId: string) => void;
	/** A failed read. Every current caller keeps its last good value and degrades the empty case. */
	onFailure?: (workspaceId: string) => void;
	/**
	 * The read being **left** (the workspace switched, or `readKey` changed): drop whatever belonged to it,
	 * before the next read lands.
	 */
	onSwitch?: (workspaceId: string) => void;
}

/**
 * Read something for a workspace and keep it live: on workspace change, on that workspace's fs tick (the
 * host's debounced `workspace.fsChanged` nudge), and on demand through the returned `reload` (a manual
 * Refresh). A null `workspaceId` reads nothing — which is also how a *paused* read is expressed (a collapsed
 * `FileTree` dir), so no tick has to be threaded down as a prop.
 *
 * This is the one place the worktree-scoped panel reads share, so none of them re-implements the guard that
 * makes a switch safe: a response in flight when the caller has moved on must not land in the new
 * workspace's view. Reads are generation-stamped — the latest one wins, abandoned ones stay silent.
 *
 * Two deliberate shapes keep the effect's dependency list **honest**, every entry genuinely read in the body,
 * so nothing here needs an exhaustive-deps exemption:
 * - the **fs tick is consumed as an event** (`useAppStore.subscribe`) rather than selected into the
 *   component: it triggers a re-read without being a render input, and consumers stop re-rendering on
 *   unrelated worktree churn;
 * - the **reset is the effect's cleanup**, which closes over the workspace being *left* — the id a reset
 *   actually needs (a plain effect keyed on `workspaceId` runs with the *new* id already in scope);
 * - a manual refresh is an **imperative `reload()`**, not a nonce dependency.
 *
 * `readKey` is a **second identity dimension** of the read, for a caller whose read has a parameter beyond the
 * workspace (the Changes panel's diff scope): changing it re-reads exactly like a workspace switch — reset
 * first (`onSwitch`), then a fresh, generation-stamped read — so one key's value can never linger under
 * another. It is threaded to `read` as its second argument (and to `reload`), so it is genuinely consumed
 * rather than being a dependency the effect merely names.
 */
export function useWorkspaceRead<T>(
	workspaceId: string | null,
	read: (workspaceId: string, readKey: string | undefined) => Promise<T>,
	handlers: WorkspaceReadHandlers<T>,
	readKey?: string,
): { reload: () => void } {
	const latest = useRef({ read, handlers });
	latest.current = { read, handlers };
	// Stamps each read. A newer read — or a switch/unmount — invalidates the ones before it, so a slow
	// response can tell it is stale without a per-call-site cancellation flag.
	const generation = useRef(0);

	const runRead = useCallback((id: string, key: string | undefined) => {
		const mine = ++generation.current;
		const live = () => generation.current === mine;
		latest.current
			.read(id, key)
			.then((value) => {
				if (live()) latest.current.handlers.onResult(value, id);
			})
			.catch(() => {
				if (live()) latest.current.handlers.onFailure?.(id);
			});
	}, []);

	useEffect(() => {
		if (!workspaceId) return;
		runRead(workspaceId, readKey);
		let tick = selectWorkspaceTick(useAppStore.getState(), workspaceId);
		const unsubscribe = useAppStore.subscribe((state) => {
			const next = selectWorkspaceTick(state, workspaceId);
			if (next === tick) return;
			tick = next;
			runRead(workspaceId, readKey);
		});
		return () => {
			unsubscribe();
			generation.current += 1; // abandon this workspace's in-flight read
			latest.current.handlers.onSwitch?.(workspaceId);
		};
	}, [workspaceId, readKey, runRead]);

	return {
		reload: () => {
			if (workspaceId) runRead(workspaceId, readKey);
		},
	};
}
