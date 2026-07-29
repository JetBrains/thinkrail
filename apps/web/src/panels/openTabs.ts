import { projectRelativePath } from "../lib";
import {
	type EditorTab,
	selectWorkspaceById,
	selectWorkspaceTick,
	type TabIntent,
	useAppStore,
} from "../store";
import { getTransport } from "../transport";
import { diffTabId } from "./changesModel";

/**
 * The center-tab openers: one file tab, one diff tab. Shared by the file tree, the Specs panel, the
 * Changes panel, rendered-markdown relative links, and the chat's spec deep link, so every surface gets
 * identical de-dupe/focus/preview behavior. `intent` decides whether the open lands in the workspace's
 * single preview slot (`"preview"` — a click, a link follow) or takes a tab of its own (`"keep"` — a
 * double click); see `store/SPEC.md` for the slot's rules and `SPEC.md` for the gesture map.
 */

function baseName(path: string): string {
	return path.split("/").pop() || path;
}

/**
 * Focus an already-open tab (promoting it when the intent is `keep` — one atomic store write, so the strip
 * never renders an in-between state), else read its content and open a fresh one. A read failure (missing
 * file, not text, no diff) is a no-op: tabs are left as they were and the source row stays for a retry.
 */
async function openReadTab<T>(
	workspaceId: string,
	id: string,
	intent: TabIntent,
	read: () => Promise<T>,
	build: (payload: T, loadedTick: number) => EditorTab,
): Promise<void> {
	const store = useAppStore.getState();
	if ((store.tabsByWorkspace[workspaceId] ?? []).some((t) => t.id === id)) {
		store.setActiveTab(id, intent);
		return;
	}
	try {
		const payload = await read();
		// Stamp the workspace's current fs tick: the content is fresh as of now, so the pane's live re-read
		// only fires for ticks arriving AFTER this open.
		const loadedTick = selectWorkspaceTick(useAppStore.getState(), workspaceId);
		useAppStore.getState().openTab(build(payload, loadedTick), intent);
	} catch {
		// a failed read leaves tabs unchanged
	}
}

/**
 * Open a worktree file as a center editor tab.
 *
 * `path` may arrive **absolute or `./`-prefixed** (a pi tool call reports whichever the agent passed), so it
 * is canonicalized to the worktree-relative form here — the tab id is derived from it, and the host resolves
 * an in-worktree absolute path happily, so a caller passing one would otherwise silently open a SECOND tab
 * for a file already open under its relative path. The choke point is the only place that can guarantee one
 * file = one tab identity, which is why it normalizes rather than trusting each caller.
 */
export function openFileInTab(
	workspaceId: string,
	reported: string,
	intent: TabIntent,
): Promise<void> {
	const path = projectRelativePath(
		reported,
		selectWorkspaceById(useAppStore.getState(), workspaceId)?.worktreePath,
	);
	const id = `${workspaceId}:${path}`;
	return openReadTab(
		workspaceId,
		id,
		intent,
		() => getTransport().request("fs.readFile", { workspaceId, path }),
		({ content }, loadedTick) => ({
			kind: "file",
			id,
			workspaceId,
			path,
			name: baseName(path),
			content,
			loadedTick,
		}),
	);
}

/** Open a changed file's read-only diff (base branch vs worktree) as a center tab — one tab per file. */
export function openDiffInTab(workspaceId: string, path: string, intent: TabIntent): Promise<void> {
	const id = diffTabId(workspaceId, path);
	return openReadTab(
		workspaceId,
		id,
		intent,
		() => getTransport().request("git.diffFile", { workspaceId, path }),
		({ original, modified }, loadedTick) => ({
			kind: "diff",
			id,
			workspaceId,
			path,
			name: baseName(path),
			original,
			modified,
			loadedTick,
		}),
	);
}
