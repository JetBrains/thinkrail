/**
 * Reference assembly of the Tauri bridge initialization script.
 *
 * The script that runs in the main window is two seed globals followed by
 * `tauri-bootstrap.js`:
 *
 * 1. `__THINKRAIL_INITIAL_WINDOW_CHROME__` and
 *    `__THINKRAIL_INITIAL_DESKTOP_PREFERENCES__` (configurable, so the bridge
 *    consumes them exactly like `takePreloadGlobal`), and
 * 2. the bridge source, which writes the first-paint window-chrome CSS and
 *    installs the same frozen non-enumerable globals the Electrobun preload
 *    did, against `globalThis.__TAURI__` (`core.invoke` / `event.listen`).
 *
 * The Rust shell builds and registers the real script: `src-tauri/src/bridge.rs`
 * embeds `tauri-bootstrap.js` with `include_str!` and prepends the same seed
 * lines, and `main.rs` passes the result to
 * `WebviewWindowBuilder::initialization_script` before the sidecar page loads.
 * This module mirrors that assembly so `injection.test.ts` can run the exact
 * bootstrap source in a VM and check it against the web shape-guards.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INITIAL_DESKTOP_PREFERENCES_GLOBAL } from "../preferenceAdapter";
import { prependPreloadGlobal } from "../preloadGlobals";
import { INITIAL_WINDOW_CHROME_GLOBAL, type WindowChromePreloadSeed } from "../windowChrome";

export interface TauriWindowSeed {
	windowChrome: WindowChromePreloadSeed;
	preferences: Readonly<Record<string, string>>;
}

/** The bridge source the Rust shell embeds, byte for byte. */
export function tauriBootstrapSource(): string {
	return readFileSync(join(import.meta.dir, "tauri-bootstrap.js"), "utf8");
}

/** Seed globals plus the bridge source, in the order `bridge.rs` emits them. */
export function tauriInitializationScript(windowSeed: TauriWindowSeed): string {
	return prependPreloadGlobal(
		prependPreloadGlobal(
			tauriBootstrapSource(),
			INITIAL_DESKTOP_PREFERENCES_GLOBAL,
			windowSeed.preferences,
		),
		INITIAL_WINDOW_CHROME_GLOBAL,
		windowSeed.windowChrome,
	);
}
