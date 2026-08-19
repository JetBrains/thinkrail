import type { GitDiffScope } from "@thinkrail/contracts";
import {
	DOUBLE_CLICK_SETTLE_MS,
	layoutResourceIdentity,
	projectRelativePath,
	tupleKey,
} from "../lib";
import {
	type CenterNavigationStamp,
	type EditorTab,
	isCenterNavigationCurrent,
	layoutOpenOptionsForNavigation,
	selectDiffTabTargetRef,
	selectWorkspaceById,
	selectWorkspaceNavTick,
	selectWorkspaceTick,
	type TabIntent,
	useAppStore,
} from "../store";
import { getTransport } from "../transport";
import { diffTabId, diffTabName } from "./changesModel";

/**
 * The center-tab openers: one file tab, one diff tab. Shared by the file tree, the Specs panel, the
 * Changes panel, rendered-markdown relative links, and the chat's spec deep link, so every surface gets
 * identical de-dupe/focus/preview behavior. `intent` decides whether the open lands in its destination
 * center group's preview slot (`"preview"` — a click, a link follow) or becomes kept (`"keep"` — a double
 * click); see `store/SPEC.md` for request-time routing and `SPEC.md` for the gesture map.
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
const inFlight = new Map<
	string,
	{
		intent: TabIntent;
		/** The leading preview half of a double click must still replace the destination preview slot. */
		claimPreview: boolean;
		navigation: CenterNavigationStamp | null;
		requestedAt: number;
		startedAt: number;
	}
>();

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
	resourceIdentity: string,
	intent: TabIntent,
	read: () => Promise<T>,
	build: (payload: T, loadedTick: number) => EditorTab,
	requestedNavigation?: CenterNavigationStamp | null,
): Promise<void> {
	// The request itself is the navigation: it marks "this is what the user wants next". Clicking an unopened
	// file writes no store state of its own, so without this two browses clicked in a row would record the
	// same count, and the first read to land would invalidate the second — leaving the FIRST click's file
	// open. The mark is what lets a later browse supersede an earlier one still in flight.
	const navigation =
		requestedNavigation === undefined
			? useAppStore.getState().beginCenterNavigation(workspaceId)
			: requestedNavigation;
	const store = useAppStore.getState();
	if (store.removedWorkspaceIds[workspaceId]) return;
	if (intent === "preview" && !isCenterNavigationCurrent(store, workspaceId, navigation)) return;
	const pending = inFlight.get(id);
	if (pending) {
		// The read is already on its way — fold this call into it instead of racing a second read against it.
		// Intent only ever moves upward: promotion is one-way, so a trailing browse can't undo a keep. The
		// request mark moves forward too, because re-clicking the same row is not navigating away from it.
		if (intent === "preview") pending.claimPreview = true;
		if (intent === "keep") pending.intent = "keep";
		pending.navigation = navigation;
		pending.requestedAt = navTick(workspaceId);
		return;
	}
	const flight = {
		intent,
		claimPreview: intent === "preview",
		navigation,
		requestedAt: navTick(workspaceId),
		startedAt: Date.now(),
	};
	inFlight.set(id, flight);
	const cached = (store.tabsByWorkspace[workspaceId] ?? []).find(
		(tab) =>
			(tab.kind === "file" || tab.kind === "diff") &&
			layoutResourceIdentity(tab) === resourceIdentity,
	);
	if (cached) {
		try {
			// A cached row still receives click/click/dblclick. Give that gesture the same coalescing window as
			// a host read so it publishes one final keep instead of three focus/placement mutations.
			if (flight.intent === "preview") {
				await new Promise((resolve) => setTimeout(resolve, DOUBLE_CLICK_SETTLE_MS));
			}
			const currentState = useAppStore.getState();
			const latestCached = (currentState.tabsByWorkspace[workspaceId] ?? []).find(
				(tab) =>
					(tab.kind === "file" || tab.kind === "diff") &&
					layoutResourceIdentity(tab) === resourceIdentity,
			);
			// The settle window must not resurrect a cache closed after the click or overwrite a live refresh
			// with the object captured before that refresh. The semantic cache currently installed is the only
			// safe source for the final placement intent.
			if (!latestCached) return;
			const overtaken = flight.navigation
				? !isCenterNavigationCurrent(currentState, workspaceId, flight.navigation)
				: navTick(workspaceId) !== flight.requestedAt;
			if (flight.intent === "preview" && overtaken) return;
			const options = layoutOpenOptionsForNavigation(currentState, workspaceId, flight.navigation);
			useAppStore
				.getState()
				.openTab(
					latestCached,
					flight.intent,
					true,
					flight.intent === "keep" && flight.claimPreview && !overtaken
						? { ...options, claimPreview: true }
						: options,
				);
		} finally {
			inFlight.delete(id);
		}
		return;
	}
	// Stamped BEFORE the read leaves, not after it lands: the stamp is a claim about what the content was
	// read against, and the store can move while the request is in flight. Reading it from the store on the
	// way back would claim a state the content never saw — a change frame arriving mid-read would be recorded
	// as already reflected, and the pane would never re-read it. Captured early it is at worst pessimistic:
	// the live-refresh contract sees the drift and does one extra read. (Same rule as `markSkillsSynced`.)
	const loadedTick = selectWorkspaceTick(useAppStore.getState(), workspaceId);
	try {
		const payload = await read();
		// Keep the completed read in the coalescing window long enough for the browser's trailing `dblclick`.
		// I/O starts on the leading click, but no preview snapshot is published if that click becomes a keep.
		if (flight.intent === "preview") {
			const remaining = DOUBLE_CLICK_SETTLE_MS - (Date.now() - flight.startedAt);
			if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
		}
		// Overtaken while reading — the user went somewhere else since. Drop a browse they've moved on from
		// so the last navigation wins. A `keep` still commits: it was deliberate, and silently swallowing a
		// tab the user explicitly asked for would be the worse surprise.
		const currentState = useAppStore.getState();
		const overtaken = flight.navigation
			? !isCenterNavigationCurrent(currentState, workspaceId, flight.navigation)
			: navTick(workspaceId) !== flight.requestedAt;
		if (flight.intent === "preview" && overtaken) return;
		const installedCache = (currentState.tabsByWorkspace[workspaceId] ?? []).find(
			(tab) =>
				(tab.kind === "file" || tab.kind === "diff") &&
				layoutResourceIdentity(tab) === resourceIdentity,
		);
		const tab = installedCache ?? build(payload, loadedTick);
		const options = layoutOpenOptionsForNavigation(currentState, workspaceId, flight.navigation);
		// A leading click upgraded by its dblclick publishes only the final keep intent. `claimPreview` carries
		// the leading click's slot semantics into that one snapshot, so keeping does not append beside the tab
		// that the gesture previewed over.
		useAppStore
			.getState()
			.openTab(
				tab,
				flight.intent,
				true,
				flight.intent === "keep" && flight.claimPreview && !overtaken
					? { ...options, claimPreview: true }
					: options,
			);
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
	requestedNavigation?: CenterNavigationStamp | null,
): Promise<void> {
	const path = projectRelativePath(
		reported,
		selectWorkspaceById(useAppStore.getState(), workspaceId)?.worktreePath,
	);
	const id = tupleKey("file", workspaceId, path);
	return openReadTab(
		workspaceId,
		id,
		layoutResourceIdentity({ kind: "file", id, name: baseName(path), path }),
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
		requestedNavigation,
	);
}

/**
 * Open a changed file's read-only diff as a center tab — one tab per **(file, scope)**: the scope is part of
 * the tab's identity *and* is carried on the tab, so its content can never change meaning because the rail's
 * scope flipped underneath it.
 */
export function openDiffInTab(
	workspaceId: string,
	scope: GitDiffScope,
	path: string,
	intent: TabIntent,
	requestedNavigation?: CenterNavigationStamp | null,
): Promise<void> {
	const canonicalPath = projectRelativePath(
		path,
		selectWorkspaceById(useAppStore.getState(), workspaceId)?.worktreePath,
	);
	const id = diffTabId(workspaceId, scope, canonicalPath);
	// The review target as it stands *now*, before the read is issued — the value `git.diffFile` will resolve
	// against. Read from the store after the response instead, a `workspace.setDiffBase` broadcast landing
	// mid-read would stamp the NEW target onto contents diffed against the OLD one: no key drift for
	// `useLiveTabContent` to see, so the stale diff would sit under the new target indefinitely.
	const target = selectDiffTabTargetRef(useAppStore.getState(), { workspaceId, scope });
	return openReadTab(
		workspaceId,
		id,
		layoutResourceIdentity({
			kind: "diff",
			id,
			name: diffTabName(scope, canonicalPath),
			path: canonicalPath,
			scope,
		}),
		intent,
		() => getTransport().request("git.diffFile", { workspaceId, path: canonicalPath, scope }),
		({ original, modified }, loadedTick) => ({
			kind: "diff",
			id,
			workspaceId,
			path: canonicalPath,
			scope,
			name: diffTabName(scope, canonicalPath),
			original,
			modified,
			loadedTick,
			// Stamp the target the content was read against, next to the fs tick: `DiffPane` compares it on mount,
			// so a tab whose target was re-pointed while it sat in the background — or *during this very read* —
			// re-reads when activated.
			loadedTarget: target,
		}),
		requestedNavigation,
	);
}
