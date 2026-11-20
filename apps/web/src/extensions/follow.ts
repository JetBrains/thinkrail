import { clientErrorReport, reportClientError } from "../transport";
import { type InstalledWebExtension, PRE_RENDER_WAIT_MS, syncWebExtensions } from "./loader";

/** The app's view of the host's installed web halves, injected so this module never reads a store. */
export interface InstalledWebExtensionSource {
	/** The set to converge on, or `null` while it is not known. */
	current(): readonly InstalledWebExtension[] | null;
	/** Waiting can no longer help the first render: the connection or the list failed. */
	unreachable(): boolean;
	/** Fires when `current()` or `unreachable()` may have changed. */
	subscribe(listener: () => void): () => void;
	/** Whether the last set this host listed had a web half; `false` when nothing is remembered. */
	rememberedAny(): boolean;
	/** Keeps whether the set just learned has a web half, for the next page load. */
	remember(any: boolean): void;
}

function reportFollowFailure(error: unknown): void {
	reportClientError(clientErrorReport("rejection", error, "extension-follow"));
}

/**
 * Keeps the loaded web halves in step with the source for the life of the page. The promise never
 * rejects: it settles at once when the host's last known set had no web half, else when the first known
 * set has loaded, the source is unreachable, or `waitMs` passed — so bootstrap can hold the first render
 * for it without ever hanging. A throw while following is reported and settles it.
 */
export function followInstalledWebExtensions(
	source: InstalledWebExtensionSource,
	waitMs: number = PRE_RENDER_WAIT_MS,
	report: (error: unknown) => void = reportFollowFailure,
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
		const fail = (error: unknown) => {
			report(error);
			settle();
		};
		let remembered: boolean | undefined;
		const apply = () => {
			try {
				const descriptors = source.current();
				if (descriptors === null) {
					if (source.unreachable()) settle();
					return;
				}
				const any = descriptors.length > 0;
				if (any !== remembered) {
					remembered = any;
					source.remember(any);
				}
				const loads = syncWebExtensions(descriptors);
				if (!settled) void loads.then(settle, fail);
			} catch (error) {
				fail(error);
			}
		};
		try {
			remembered = source.rememberedAny();
			if (remembered) timer = setTimeout(settle, waitMs);
			else settle();
			source.subscribe(apply);
		} catch (error) {
			fail(error);
			return;
		}
		apply();
	});
}
