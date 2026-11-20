import type { ExtensionHostService, ExtensionHostServices } from "@thinkrail/extension-api/server";
import type { ExtensionDisabled } from "./inline";
import type { ExtensionHostServicesFor } from "./queries";
import { type ServerExtensionEntry, serverExtensions } from "./registry";

export interface ExtensionHostServiceRunner {
	/** Starts every enabled extension's service that is not running and stops every disabled one's. */
	sync(): void;
	/** Stops every running service; later `sync` calls start nothing. */
	stop(): Promise<void>;
}

interface RunningService {
	host: ExtensionHostServices;
	service: ExtensionHostService;
	controller: AbortController;
}

export function runExtensionHostServices(options: {
	isDisabled: ExtensionDisabled;
	services: ExtensionHostServicesFor;
	entries?: readonly ServerExtensionEntry[];
}): ExtensionHostServiceRunner {
	const entries = options.entries ?? serverExtensions;
	const running = new Map<string, RunningService>();
	let stopped = false;

	const stopOne = async (name: string): Promise<void> => {
		const current = running.get(name);
		if (!current) return;
		running.delete(name);
		try {
			await current.service.stop?.();
		} catch (error) {
			current.host.log.warn("its host service failed to stop", error);
		} finally {
			current.controller.abort();
		}
	};

	return {
		sync() {
			if (stopped) return;
			for (const { extension } of entries) {
				if (!extension.hostService) continue;
				const { name } = extension;
				if (options.isDisabled(name)) {
					void stopOne(name);
					continue;
				}
				if (running.has(name)) continue;
				const controller = new AbortController();
				const host = options.services(name, controller.signal);
				try {
					running.set(name, { host, service: extension.hostService(host) ?? {}, controller });
				} catch (error) {
					controller.abort();
					host.log.warn("its host service failed to start", error);
				}
			}
		},
		async stop() {
			stopped = true;
			await Promise.all([...running.keys()].map(stopOne));
		},
	};
}
