import { projectRelativePath } from "../lib";
import { selectWorkspaceById, selectWorkspaceTick, useAppStore } from "../store";
import { getTransport } from "../transport";

/**
 * Open a worktree file as a center editor tab: focus it if already open, else read its content and open
 * a new tab. Shared by the file tree, rendered-markdown relative links, and the chat's spec deep link, so
 * all of them get identical de-dupe/focus behavior. A read failure (missing file / not text) is a no-op.
 *
 * `path` may arrive **absolute or `./`-prefixed** (a pi tool call reports whichever the agent passed), so it
 * is canonicalized to the worktree-relative form here — the tab id is derived from it, and the host resolves
 * an in-worktree absolute path happily, so a caller passing one would otherwise silently open a SECOND tab
 * for a file already open under its relative path. The choke point is the only place that can guarantee one
 * file = one tab identity, which is why it normalizes rather than trusting each caller.
 */
export async function openFileInTab(workspaceId: string, reported: string): Promise<void> {
	const store = useAppStore.getState();
	const path = projectRelativePath(reported, selectWorkspaceById(store, workspaceId)?.worktreePath);
	const id = `${workspaceId}:${path}`;
	if ((store.tabsByWorkspace[workspaceId] ?? []).some((t) => t.id === id)) {
		store.setActiveTab(id);
		return;
	}
	try {
		const { content } = await getTransport().request("fs.readFile", { workspaceId, path });
		const name = path.split("/").pop() || path;
		// Stamp the workspace's current fs tick: the content is fresh as of now, so FilePane's live
		// re-read only fires for ticks arriving AFTER this open.
		const loadedTick = selectWorkspaceTick(useAppStore.getState(), workspaceId);
		useAppStore
			.getState()
			.openTab({ kind: "file", id, workspaceId, path, name, content, loadedTick });
	} catch {
		// a read failure (missing file / not text) leaves tabs unchanged
	}
}
