import type { DesktopResizeEdge, DesktopWindowChromePlatform } from "./windowChrome";

export const INITIAL_WINDOW_CHROME_PLATFORM_GLOBAL = "__THINKRAIL_INITIAL_WINDOW_CHROME_PLATFORM__";
export const WINDOW_CHROME_GLOBAL = "__THINKRAIL_NATIVE_WINDOW_CHROME__";

export function readPreloadWindowChromePlatform(
	value: unknown,
): DesktopWindowChromePlatform | null {
	return value === "macos" || value === "windows" || value === "linux" ? value : null;
}

export function injectWindowChromePlatform(
	preloadSource: string,
	platform: DesktopWindowChromePlatform,
): string {
	return `Object.defineProperty(globalThis, ${JSON.stringify(INITIAL_WINDOW_CHROME_PLATFORM_GLOBAL)}, { value: ${JSON.stringify(platform)}, configurable: true });\n${preloadSource}`;
}

export type DesktopWindowChromeCommand =
	| { kind: "minimize" }
	| { kind: "toggle-maximize" }
	| { kind: "request-close" }
	| { kind: "start-resize"; edge: DesktopResizeEdge };

export interface PreloadWindowChromeAdapter {
	readonly version: 1;
	readonly platform: DesktopWindowChromePlatform;
	getSnapshot(): { maximized: boolean };
	subscribe(listener: () => void): () => void;
	minimize(): void;
	toggleMaximize(): void;
	requestClose(): void;
	startResize(edge: DesktopResizeEdge): void;
}

export function createPreloadWindowChrome({
	platform,
	dispatch,
}: {
	platform: DesktopWindowChromePlatform;
	dispatch(command: DesktopWindowChromeCommand): void;
}): {
	adapter: PreloadWindowChromeAdapter;
	applySnapshot(payload: unknown): boolean;
} {
	let snapshot = { maximized: false };
	const listeners = new Set<() => void>();
	const adapter: PreloadWindowChromeAdapter = {
		version: 1,
		platform,
		getSnapshot: () => snapshot,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		minimize: () => dispatch({ kind: "minimize" }),
		toggleMaximize: () => dispatch({ kind: "toggle-maximize" }),
		requestClose: () => dispatch({ kind: "request-close" }),
		startResize: (edge) => dispatch({ kind: "start-resize", edge }),
	};
	return {
		adapter: Object.freeze(adapter),
		applySnapshot: (payload) => {
			if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
			const maximized = Reflect.get(payload, "maximized");
			if (typeof maximized !== "boolean") return false;
			if (snapshot.maximized === maximized) return true;
			snapshot = { maximized };
			for (const listener of listeners) listener();
			return true;
		},
	};
}
