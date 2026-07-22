import { useAppStore } from "../store";
import { getTransport } from "../transport";

/**
 * Open a worktree file as a center editor tab: focus it if already open, else read its content and open
 * a new tab. `path` is worktree-relative. Shared by the file tree and rendered-markdown relative links,
 * so both get identical de-dupe/focus behavior. A read failure (missing file / not text) is a no-op.
 * A successful open (or focusing an already-open tab) records the document in the workspace's History.
 */
export async function openFileInTab(workspaceId: string, path: string): Promise<void> {
	const id = `${workspaceId}:${path}`;
	const name = path.split("/").pop() || path;
	const store = useAppStore.getState();
	if ((store.tabsByWorkspace[workspaceId] ?? []).some((t) => t.id === id)) {
		store.setActiveTab(id);
		store.noteDocOpened(workspaceId, { kind: "file", path, name });
		return;
	}
	try {
		const { content } = await getTransport().request("fs.readFile", { workspaceId, path });
		// Stamp the workspace's current fs tick: the content is fresh as of now, so FilePane's live
		// re-read only fires for ticks arriving AFTER this open.
		const loadedTick = useAppStore.getState().fsChangesByWorkspace[workspaceId]?.tick ?? 0;
		useAppStore
			.getState()
			.openTab({ kind: "file", id, workspaceId, path, name, content, loadedTick });
		useAppStore.getState().noteDocOpened(workspaceId, { kind: "file", path, name });
	} catch {
		// a read failure (missing file / not text) leaves tabs unchanged — and unrecorded
	}
}

/**
 * Open a changed file's diff as a center tab (Monaco diff editor): focus it if already open, else open
 * a new tab named after the file. Lean by design — `DiffPane` fetches and reconstructs the two sides
 * itself, so this never hits the wire. The `diff:` id prefix keeps the tab distinct from the same
 * path's plain file tab. Shared by the Changes list rows and the chat turn-divider deep-link.
 * Records the diff in the workspace's History (open or focus-existing).
 */
export function openDiffInTab(workspaceId: string, path: string): void {
	const id = `diff:${workspaceId}:${path}`;
	const name = path.split("/").pop() || path;
	const store = useAppStore.getState();
	if ((store.tabsByWorkspace[workspaceId] ?? []).some((t) => t.id === id)) {
		store.setActiveTab(id);
	} else {
		store.openTab({ kind: "diff", id, workspaceId, path, name });
	}
	store.noteDocOpened(workspaceId, { kind: "diff", path, name });
}
