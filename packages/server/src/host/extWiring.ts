import { join } from "node:path";
import type { Project } from "@thinkrail/contracts";
import {
	getSessionStats,
	listLiveSessionRefs,
	reloadSessionsForHostExtensions,
	setHostExtensionFactorySource,
} from "../agent";
import { createExtHost } from "../ext";
import { logger } from "../log";
import { dataDir } from "../persistence";

const log = logger("ext");

export const trustedProjectRoots = (projects: readonly Project[]) =>
	projects
		.filter((project) => project.trusted === true && project.closed !== true)
		.map((project) => ({ projectId: project.id, path: project.path }));

export const installExtHost = () => {
	const extHost = createExtHost({
		userDir: join(dataDir(), "extensions"),
		storeDir: join(dataDir(), "ext-store"),
		sessions: {
			list: listLiveSessionRefs,
			get: (sessionId) => listLiveSessionRefs().find((ref) => ref.sessionId === sessionId),
			stats: getSessionStats,
		},
		onPiFactoriesChanged: reloadSessionsForHostExtensions,
		warn: (message) => log.warn(message),
	});
	setHostExtensionFactorySource({
		factories: extHost.piFactories,
		onError: (factory, error) => {
			const owner = extHost.piFactoryOwner(factory);
			const message = `pi factory failed: ${error instanceof Error ? error.message : String(error)}`;
			if (owner) extHost.recordError(owner, message);
			else log.warn(message);
		},
	});
	const dispose = async () => {
		setHostExtensionFactorySource(undefined);
		await extHost.dispose();
	};
	return { extHost, dispose };
};
