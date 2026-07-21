import { ModelRuntime } from "@earendil-works/pi-coding-agent";

/**
 * The shared pi model/auth runtime — one `ModelRuntime` for every session (pi's canonical SDK facade
 * since 0.80.8: models, credentials, availability, login/logout, and request dispatch in one object).
 * Built lazily on first use so `PI_CODING_AGENT_DIR` set before that point is honored (tests and the
 * e2e harnesses rely on this), and memoized as a promise because `ModelRuntime.create()` is async.
 */
let runtime: Promise<ModelRuntime> | null = null;

/** Override the shared runtime — tests inject a faux-backed one so no auth/network is needed. */
export function configurePiRuntime(rt: ModelRuntime | null): void {
	runtime = rt ? Promise.resolve(rt) : null;
}

/** The shared runtime, built lazily from on-disk auth + catalogs (`~/.pi/agent`). */
export function getPiRuntime(): Promise<ModelRuntime> {
	if (!runtime) {
		const created = ModelRuntime.create();
		runtime = created;
		// A failed create must not brick the host until restart — drop the memo so the next call retries.
		created.catch(() => {
			if (runtime === created) runtime = null;
		});
	}
	return runtime;
}
