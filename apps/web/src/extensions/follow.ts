import { type InstalledWebExtension, PRE_RENDER_WAIT_MS, syncWebExtensions } from "./loader";

/** The app's view of the host's installed web halves, injected so this module never reads a store. */
export interface InstalledWebExtensionSource {
	/** The set to converge on, or `null` while it is not known. */
	current(): readonly InstalledWebExtension[] | null;
	/** Waiting can no longer help the first render: the connection or the list failed. */
	unreachable(): boolean;
	/** Fires when `current()` or `unreachable()` may have changed. */
	subscribe(listener: () => void): () => void;
}

/**
 * Keeps the loaded web halves in step with the source for the life of the page. The promise settles
 * when the first known set has loaded, the source is unreachable, or `waitMs` passed — whichever is
 * first — so bootstrap can hold the first render for it without ever hanging.
 */
export function followInstalledWebExtensions(
	source: InstalledWebExtensionSource,
	waitMs: number = PRE_RENDER_WAIT_MS,
): Promise<void> {
	return new Promise((resolve) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const settle = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve();
		};
		timer = setTimeout(settle, waitMs);
		const apply = () => {
			const descriptors = source.current();
			if (descriptors === null) {
				if (source.unreachable()) settle();
				return;
			}
			const loads = syncWebExtensions(descriptors);
			if (!settled) void loads.then(settle);
		};
		source.subscribe(apply);
		apply();
	});
}
