import { projectRelativePath } from "../lib";
import {
	type EditorTab,
	selectWorkspaceById,
	selectWorkspaceNavTick,
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
 * Opens whose read is still in flight, by tab id → the intent the tab should end up with.
 *
 * A double click dispatches `click`, `click`, `dblclick`, so a row opens the same not-yet-open file three
 * times with mixed intents before the first `fs.readFile` returns. Left unguarded, all three read and
 * whichever lands first decides the placement: a leading `preview` replaces the tab in the slot, while a
 * `keep` landing first appends and spares it — one gesture, two outcomes, split by round-trip latency
 * (so the app would behave one way on localhost and another over Tailscale from a phone).
 *
 * Collapsing the flight to a single read settles it: the call that STARTED the read owns the placement,
 * and an intent upgraded to `keep` while it was in flight is applied as a promote afterwards. That is
 * exactly what the gesture means — a double click is a preview open (which claims the slot, as every
 * IDE's does) plus a promote — and it holds at any latency.
 */
const inFlight = new Map<string, { intent: TabIntent; requestedAt: number }>();

/**
 * The workspace's center-navigation count, as the store keeps it (`navTickByWorkspace`). A read records it
 * on the way out and compares on the way back: a click is instant and an `fs.readFile` is not, so anything
 * the user does while a browse is loading has to win. The counter lives in the store precisely so that no
 * focus transition — a strip click, a close, a reopened chat, a `doc` tab, a new chat — can bypass it.
 */
function navTick(workspaceId: string): number {
	return selectWorkspaceNavTick(useAppStore.getState(), workspaceId);
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
	// The request itself is the navigation: it marks "this is what the user wants next". Clicking an unopened
	// file writes no store state of its own, so without this two browses clicked in a row would record the
	// same count, and the first read to land would invalidate the second — leaving the FIRST click's file
	// open. The mark is what lets a later browse supersede an earlier one still in flight.
	useAppStore.getState().noteNavigation(workspaceId);
	const store = useAppStore.getState();
	if ((store.tabsByWorkspace[workspaceId] ?? []).some((t) => t.id === id)) {
		store.setActiveTab(id, intent);
		return;
	}
	const pending = inFlight.get(id);
	if (pending) {
		// The read is already on its way — fold this call into it instead of racing a second read against it.
		// Intent only ever moves upward: promotion is one-way, so a trailing browse can't undo a keep. The
		// request mark moves forward too, because re-clicking the same row is not navigating away from it.
		if (intent === "keep") pending.intent = "keep";
		pending.requestedAt = navTick(workspaceId);
		return;
	}
	const flight = { intent, requestedAt: navTick(workspaceId) };
	inFlight.set(id, flight);
	try {
		const payload = await read();
		// Overtaken while reading — the user went somewhere else since. Drop a browse they've moved on from
		// so the last navigation wins. A `keep` still commits: it was deliberate, and silently swallowing a
		// tab the user explicitly asked for would be the worse surprise.
		if (flight.intent === "preview" && navTick(workspaceId) !== flight.requestedAt) return;
		// Stamp the workspace's current fs tick: the content is fresh as of now, so the pane's live re-read
		// only fires for ticks arriving AFTER this open.
		const loadedTick = selectWorkspaceTick(useAppStore.getState(), workspaceId);
		const tab = build(payload, loadedTick);
		useAppStore.getState().openTab(tab, intent);
		// Upgraded mid-read (the `dblclick` behind this gesture's leading `click`) — apply the promote. Both
		// writes land in one tick, so the strip never flashes the italic in between. `openTab` again, NOT
		// `setActiveTab`: only `openTab` keys off `tab.workspaceId`. A slow read the user switches workspaces
		// during would otherwise strand this one previewing and write its tab id into the workspace they
		// moved to, whose center pane resolves no active tab and drops to the workspace receipt.
		if (flight.intent !== intent) useAppStore.getState().openTab(tab, flight.intent);
	} catch {
		// a failed read leaves tabs unchanged
	} finally {
		inFlight.delete(id);
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
