import { Updater, Utils } from "electrobun/main";
import {
	createNativeUpdateController,
	type NativeUpdateController,
	type NativeUpdaterDependency,
} from "./controller";
import { hasDesktopArtifactTestSeam, nativeUpdatesEnabled } from "./enablement";
import { createDesktopQuitCoordinator, type DesktopQuitCoordinator } from "./quitCoordinator";

export interface ElectrobunUpdateControllerOptions {
	isPackaged: boolean;
	version: string;
	channel: string;
	platform: NodeJS.Platform;
	arch: string;
	restartToUpdate(): Promise<void>;
}

const electrobunUpdater: NativeUpdaterDependency = {
	updateInfo: () => Updater.updateInfo(),
	onStatusChange: (listener) => {
		Updater.onStatusChange(listener ? (entry) => listener(entry) : null);
	},
	checkForUpdate: () => Updater.checkForUpdate(),
	downloadUpdate: () => Updater.downloadUpdate(),
};

export function createElectrobunQuitCoordinator(
	shutdown: () => Promise<void>,
): DesktopQuitCoordinator {
	return createDesktopQuitCoordinator({
		shutdown,
		quit: () => {
			Utils.quit();
		},
		applyUpdate: () => Updater.applyUpdate(),
		getUpdateError: () => Updater.updateInfo().error,
		reportUpdateFailure: async (message) => {
			await Utils.showMessageBox({
				type: "error",
				title: "ThinkRail could not restart",
				message: "ThinkRail could not restart to install the update",
				detail: message,
				buttons: ["Quit"],
			});
		},
		reportLifecycleError: (error) => {
			console.error("[desktop] update lifecycle failed", error);
		},
	});
}

export async function createElectrobunUpdateController(
	options: ElectrobunUpdateControllerOptions,
): Promise<NativeUpdateController> {
	const local = await Updater.getLocalInfo();
	const enabled = nativeUpdatesEnabled({
		isPackaged: options.isPackaged,
		channel: local.channel,
		baseUrl: local.baseUrl,
		platform: options.platform,
		arch: options.arch,
		artifactTestSeam: hasDesktopArtifactTestSeam(process.env),
	});
	return createNativeUpdateController({
		enabled,
		version: local.version || options.version,
		channel: local.channel || options.channel,
		updater: electrobunUpdater,
		restartToUpdate: options.restartToUpdate,
	});
}
