import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export interface HostExtensionFactorySource {
	factories(): readonly ExtensionFactory[];
	onError(factory: ExtensionFactory, error: unknown): void;
}

let source: HostExtensionFactorySource | undefined;

export const setHostExtensionFactorySource = (next: HostExtensionFactorySource | undefined) => {
	source = next;
};

export const hostExtensionBridge: ExtensionFactory = async (pi) => {
	const current = source;
	if (!current) return;
	for (const factory of current.factories()) {
		try {
			await factory(pi);
		} catch (error) {
			current.onError(factory, error);
		}
	}
};
