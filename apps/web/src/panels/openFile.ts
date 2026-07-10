import { useAppStore } from "../store";
import { getTransport } from "../transport";

/**
 * Open a worktree file as a center editor tab: focus it if already open, else read its content and open
 * a new tab. `path` is worktree-relative. Shared by the file tree and rendered-markdown relative links,
 * so both get identical de-dupe/focus behavior. A read failure (missing file / not text) is a no-op.
 */
export async function openFileInTab(workspaceId: string, path: string): Promise<void> {
	const id = `${workspaceId}:${path}`;
	const store = useAppStore.getState();
	if ((store.tabsByWorkspace[workspaceId] ?? []).some((t) => t.id === id)) {
		store.setActiveTab(id);
		return;
	}
	try {
		const { content } = await getTransport().request("fs.readFile", { workspaceId, path });
		const name = path.split("/").pop() || path;
		useAppStore.getState().openTab({ kind: "file", id, workspaceId, path, name, content });
	} catch {
		// a read failure (missing file / not text) leaves tabs unchanged
	}
}
