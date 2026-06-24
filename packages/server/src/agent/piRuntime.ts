import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

/** Shared pi services — one `authStorage` + `modelRegistry` for every session (per Appendix A). */
export interface PiRuntime {
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
}

let runtime: PiRuntime | null = null;

/** Override the shared runtime — tests inject a faux-backed registry so no auth/network is needed. */
export function configurePiRuntime(rt: PiRuntime): void {
	runtime = rt;
}

/** The shared runtime, built lazily from on-disk auth (`~/.pi/agent`) + the built-in model registry. */
export function getPiRuntime(): PiRuntime {
	if (!runtime) {
		const authStorage = AuthStorage.create();
		runtime = { authStorage, modelRegistry: ModelRegistry.create(authStorage) };
	}
	return runtime;
}
