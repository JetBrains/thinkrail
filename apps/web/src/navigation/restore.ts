import type { Workspace } from "@thinkrail/contracts";
import {
	selectAttentionCenterTab,
	selectCurrentRouteChatTarget,
	selectWorkspaceById,
	useAppStore,
} from "../store";
import type { NavigationDriver } from "./driver";
import { type NavigationLocation, parseFragment, serializeLocation } from "./location";

/** What the coordinator needs from its host wiring — injected so tests drive it with fakes. */
export interface NavigationDeps {
	driver: NavigationDriver;
	/**
	 * The project's authoritative workspace list, **without** the per-workspace diff-stat fan-out
	 * (`workspace.list({ includeDiffStats: false })`) — membership/order stay complete while the expensive
	 * git work stays off automatic startup.
	 */
	listWorkspaces: (projectId: string) => Promise<Workspace[]>;
}

/**
 * The location the store currently *is*, or `null` while it is momentarily underivable (an active
 * workspace whose record hasn't landed yet) — a hold, never a downgrade: writing a guessed location
 * would erase a fragment the user may be about to restore from.
 */
export function deriveLocation(state: {
	activeWorkspaceId: string | null;
	selectedProjectId: string | null;
	workspaces: Record<string, Workspace[]>;
	layoutDocumentsByWorkspace: Parameters<
		typeof selectAttentionCenterTab
	>[0]["layoutDocumentsByWorkspace"];
	layoutAttentionByWorkspace: Parameters<
		typeof selectAttentionCenterTab
	>[0]["layoutAttentionByWorkspace"];
}): NavigationLocation | null {
	const workspaceId = state.activeWorkspaceId;
	if (workspaceId) {
		const workspace = selectWorkspaceById(state, workspaceId);
		if (!workspace) return null;
		const active = selectAttentionCenterTab(state, workspaceId);
		// Shared placement may restore any resource, but the client-local route promises an exact tab only
		// for chats. Files/diffs/documents remain workspace-level in this slice.
		if (active?.kind === "chat") {
			return {
				kind: "chat",
				projectId: workspace.projectId,
				workspaceId,
				sessionId: active.sessionId,
			};
		}
		return { kind: "workspace", projectId: workspace.projectId, workspaceId };
	}
	if (state.selectedProjectId) return { kind: "project", projectId: state.selectedProjectId };
	return { kind: "main" };
}

/**
 * Start the navigation layer against the app store: canonicalize + restore the initial fragment, follow
 * later incoming fragments, cancel an exact-chat target the user navigated past, and keep the fragment in
 * sync with validated store state. Returns a teardown (tests; the app runs it for the page's life).
 *
 * Ordering rules (see `SPEC.md`): every incoming fragment advances one monotonic restore generation and
 * every asynchronous continuation re-checks it; an incoming route is *intent* validated against
 * host-owned state, never applied blind; a failed read proves nothing and leaves route + URL unchanged;
 * fresh user navigation always wins over an older asynchronous restore.
 */
export function startNavigation({ driver, listWorkspaces }: NavigationDeps): () => void {
	let generation = 0;
	/** The unresolved incoming route. While set, store→URL sync is paused. */
	let pending: { generation: number; location: NavigationLocation } | null = null;
	/** Generations whose workspace reads are in flight — each route gets at most one active read, even when
	 * an older generation settles while a newer one is still waiting. */
	const attempting = new Set<number>();
	/** The last fragment this layer wrote (or adopted) — compared before every write, so non-navigation
	 * store churn (streaming pi events above all) causes zero History API calls. */
	let lastWritten = "";

	/** Write the store-derived fragment iff sync is unpaused and the location actually changed. */
	const syncNow = () => {
		if (pending) return;
		const state = useAppStore.getState();
		// An unresolved exact-chat target owns the location: temporary workspace/no-tab/error state must
		// not overwrite the chat fragment the user is waiting on.
		if (state.routeChatTarget) return;
		const location = deriveLocation(state);
		if (!location) return;
		const fragment = serializeLocation(location);
		if (fragment === lastWritten) return;
		driver.replace(fragment);
		lastWritten = fragment;
	};

	/** Mark a route resolved (only if it is still the pending one) and let sync take over the URL. */
	const resolvePending = (gen: number) => {
		if (pending?.generation === gen) pending = null;
		syncNow();
	};

	/**
	 * Try to apply the pending route. Runs at init and on every welcome edge; a no-op until the store's
	 * atomic complete-welcome install (connection status / protocol version / an empty project list are
	 * NOT readiness), and a no-op for a superseded generation.
	 */
	const attempt = async (gen: number) => {
		if (pending?.generation !== gen || attempting.has(gen)) return;
		const location = pending.location;
		// Main has no host-owned id to validate, but it still has to be APPLIED: an incoming #/v1 while the
		// client is inside a workspace must clear that old scope rather than letting sync rewrite the hash.
		if (location.kind === "main") {
			useAppStore.getState().selectMain();
			resolvePending(gen);
			return;
		}
		const state = useAppStore.getState();
		if (state.welcomeGeneration === 0) return; // retried by the welcome subscription
		// A COMPLETED welcome that lacks the project is authoritative absence → Welcome.
		if (!state.projects.some((p) => p.id === location.projectId)) {
			useAppStore.getState().selectMain();
			resolvePending(gen);
			return;
		}
		if (location.kind === "project") {
			useAppStore.getState().selectProject(location.projectId);
			resolvePending(gen);
			return;
		}
		// Workspace/chat routes need the project's authoritative workspace list first.
		attempting.add(gen);
		let rows: Workspace[];
		try {
			rows = await listWorkspaces(location.projectId);
		} catch {
			// A timeout/disconnect/server failure is NOT evidence the workspace is gone: keep the URL and
			// the pending route untouched. The next welcome edge (reconnect) retries this same intent.
			attempting.delete(gen);
			return;
		}
		attempting.delete(gen);
		// Superseded while the read was in flight — by a newer fragment OR by user navigation (the store
		// subscription below cancels `pending` the instant either scope id moves under a pending route).
		if (pending?.generation !== gen) return;
		const now = useAppStore.getState();
		// The project can close while the read is in flight — re-check against the open snapshot.
		if (!now.projects.some((p) => p.id === location.projectId)) {
			useAppStore.getState().selectMain();
			resolvePending(gen);
			return;
		}
		now.setWorkspaces(location.projectId, rows);
		const workspace = rows.find((w) => w.id === location.workspaceId);
		if (!workspace) {
			// A successful list that lacks the id is authoritative absence → its Project Home.
			useAppStore.getState().selectProject(location.projectId);
			resolvePending(gen);
			return;
		}
		useAppStore
			.getState()
			.activateWorkspaceFromRoute(
				workspace,
				location.kind === "chat" ? location.sessionId : undefined,
			);
		// The chat half (if any) now lives in the store's routeChatTarget, which keeps sync paused until
		// shell/chatReconciliation resolves it — this coordinator's own route is done.
		resolvePending(gen);
	};

	/** A new fragment (startup or a later address-bar edit): a fresh generation cancels older intent. */
	const acceptFragment = (fragment: string) => {
		const location = parseFragment(fragment);
		generation += 1;
		pending = { generation, location };
		// A fresh navigation cancels the previous exact-chat intent (idempotent when none exists).
		useAppStore.getState().clearRouteChatTarget();
		// Canonicalize in place: a malformed/unknown fragment reads back as `#/v1`.
		const canonical = serializeLocation(location);
		if (canonical !== fragment) driver.replace(canonical);
		lastWritten = canonical;
		void attempt(generation);
	};

	const unsubscribeDriver = driver.onIncoming(acceptFragment);
	const unsubscribeStore = useAppStore.subscribe((state, previous) => {
		// Fresh user navigation wins over an unresolved restore, IMMEDIATELY: a scope move OR a center
		// navigation tick cancels it, so even a same-workspace file/chat click beats a late workspace-list
		// response. (The coordinator's own resolution writes fire this too — harmlessly, since it has already
		// installed the validated state the route asked for.)
		if (
			pending &&
			(state.selectedProjectId !== previous.selectedProjectId ||
				state.activeWorkspaceId !== previous.activeWorkspaceId ||
				state.navTickByWorkspace !== previous.navTickByWorkspace)
		) {
			pending = null;
		}
		// The atomic complete-welcome edge: retry unresolved intent (a reconnect delivers a fresh welcome),
		// but never replay a completed startup route — `pending` is gone once a route resolved.
		if (state.welcomeGeneration !== previous.welcomeGeneration && pending) {
			void attempt(pending.generation);
		}
		// Cancel an exact-chat target the user navigated past (another workspace, or a center navigation
		// that moved the stamped tick): their navigation wins, and sync may resume writing the URL.
		if (state.routeChatTarget && !selectCurrentRouteChatTarget(state)) {
			state.clearRouteChatTarget();
			return; // the nested store write re-enters this subscriber; sync runs there with fresh state
		}
		syncNow();
	});

	acceptFragment(driver.read());

	return () => {
		unsubscribeDriver();
		unsubscribeStore();
		pending = null;
	};
}
