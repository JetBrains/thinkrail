import type { WireModel } from "@thinkrail/contracts";
import { useCallback, useEffect } from "react";
import { useAppStore } from "@/store";
import { getTransport } from "@/transport";

/**
 * The models-catalog integration seam (one of chat's app-integration files that may touch store +
 * transport — see SPEC): reads the store's shared `models`, fills them via `model.list` when a consumer
 * activates on an empty list, and owns both catalog-freshness paths behind one `refresh(force)` callback. Shared
 * by `ChatView` (Composer's picker) and `panels/NewWorkspaceDialog`, so the fetch effect and the refresh
 * wiring cannot drift between the two pickers.
 */
export function useModelCatalog(active = true): {
	models: WireModel[];
	refreshing: boolean;
	refresh: (force: boolean) => void;
	fresh: boolean;
} {
	const models = useAppStore((s) => s.models);
	const refreshing = useAppStore((s) => s.modelsRefreshing);
	/**
	 * Whether `models` holds a result a caller may treat as the host's settled truth. Read straight off the
	 * store, because it is a property of the **shared list** rather than of this consumer: `models` is
	 * app-wide, so a `model.list` install from anywhere — this picker reopening, another chat mounting —
	 * replaces the list and drops its authority in the same write — and this hook drops it *synchronously*
	 * on activation, before its own read lands. See `store`'s `modelsFresh` for why `model.list` can never
	 * establish it.
	 */
	const fresh = useAppStore((s) => s.modelsFresh);

	useEffect(() => {
		if (!active) return;
		const state = useAppStore.getState();
		// Synchronously, not on the `model.list` reply: `modelsFresh` set by a *previous* consumer must not
		// straddle this activation, or a reconcile on first render reads an inherited list as this
		// opening's own truth (the registry can have moved since — a provider logged in, say).
		state.dropModelsFreshness();
		// Fetch only when there is nothing to show. A `model.list` per activation would put a full host
		// `runtime.refresh()` — provider auth fan-out included — behind every chat-tab switch, and it could
		// not establish authority anyway (its handler answers from before the refresh it starts). The
		// picker's Refresh row is the currency path.
		if (state.models.length === 0) void readModels();
	}, [active]);

	/**
	 * The picker's two freshness paths, split by whether the user actually asked for one.
	 *
	 * `force: false` (opening the picker) must stay **instant** — it is incidental to the click that
	 * opened the popover, so it takes the snapshot read. Awaiting a real refresh here would spin the row
	 * for as long as the slowest configured provider takes, up to the host's 15s abort, on every open.
	 *
	 * `force: true` (the Refresh row) is the deliberate one: await the host's forced refresh — the only
	 * path past pi's 4h throttle — spin while it runs, and install the result *with the host's own verdict*
	 * on it: `complete` says whether the pass settled inside the host's budget, and only then is the list
	 * authority (the store decides that from the reply, so nothing here re-judges it). A failure keeps the
	 * current list, and with it whatever provenance it had; the host already logged why.
	 */
	const refresh = useCallback((force: boolean) => {
		if (!force) {
			void readModels();
			return;
		}
		const state = useAppStore.getState();
		if (state.modelsRefreshing) return;
		state.beginModelsRefresh();
		getTransport()
			.request("model.refresh", { force: true })
			.then((r) => useAppStore.getState().finishModelsRefresh(r))
			.catch(() => useAppStore.getState().finishModelsRefresh(null));
	}, []);

	return { models, refreshing, refresh, fresh };
}

/**
 * `model.list`: the host's current snapshot, served without touching the network. Note it is a *moving*
 * answer — the handler fires its own detached catalog refresh before replying — so it keeps the picker's
 * list current but never establishes freshness (see `fresh`).
 */
function readModels(): Promise<void> {
	return getTransport()
		.request("model.list", {})
		.then((m) => useAppStore.getState().setModels(m))
		.catch(() => {});
}
