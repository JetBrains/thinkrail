import { useCallback, useEffect, useRef } from "react";
import { selectWorkspaceTick, useAppStore } from "../store";

/** What a caller does with each outcome of the read; the hook owns *when*, these own *what*. */
interface WorkspaceReadHandlers<T> {
	/** A landed read (never called for a response the hook has since abandoned). */
	onResult: (value: T, workspaceId: string) => void;
	/**
	 * A failed read, **with the rejection**: a caller that reacts to one specific failure (the Changes panel
	 * resets a scope whose commit is gone) needs to tell it from a timeout or a dropped socket, so the error
	 * is passed through rather than swallowed here. Otherwise: keep the last good value, degrade the empty
	 * case.
	 */
	onFailure?: (workspaceId: string, error: unknown) => void;
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
 * another. It is **identity only** — what makes a re-read happen, never what the read reads *with*: the
 * parameter itself lives in the caller's `read` closure, which this hook re-captures on every render
 * (`latest`), so the value a re-read uses is by construction the one the key describes. The key is handed to
 * `read` as its second argument for callers that would rather branch on it than close over the parameter;
 * ignoring it (as the Changes panel does, its `scope` being an object the key merely names) is expected.
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
			.catch((error: unknown) => {
				if (live()) latest.current.handlers.onFailure?.(id, error);
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
