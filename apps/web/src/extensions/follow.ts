import { clientErrorReport, reportClientError } from "../transport";
import { type InstalledWebExtension, PRE_RENDER_WAIT_MS, syncWebExtensions } from "./loader";

export interface InstalledWebExtensionSource {
	current(): readonly InstalledWebExtension[] | null;
	unreachable(): boolean;
	subscribe(listener: () => void): () => void;
	rememberedAny(): boolean;
	remember(any: boolean): void;
}

function reportFollowFailure(error: unknown): void {
	reportClientError(clientErrorReport("rejection", error, "extension-follow"));
}

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
