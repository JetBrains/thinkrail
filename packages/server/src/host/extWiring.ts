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
import { getProjects } from "../projects";

const log = logger("ext");

const trustedProjectRoots = (projects: readonly Project[]) =>
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
		onPiFactoriesChanged: () => void reloadSessionsForHostExtensions(),
		warn: (message) => log.warn(message),
	});
	setHostExtensionFactorySource({
		factories: extHost.piFactories,
		onError: (factory, error) => {
			const owner = extHost.piFactoryOwner(factory);
			if (owner) extHost.recordError(owner, "pi factory failed", error);
			else log.warn("pi factory failed", error);
		},
	});
	const syncProjectRoots = () =>
		extHost
			.setProjectRoots(trustedProjectRoots(getProjects()))
			.catch((error: unknown) => log.warn("extension rescan failed", error));
	const dispose = async () => {
		setHostExtensionFactorySource(undefined);
		await extHost.dispose();
	};
	return { extHost, syncProjectRoots, dispose };
};
