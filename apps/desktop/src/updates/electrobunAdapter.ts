import { Updater, Utils } from "electrobun/main";
import type { MenuLocale } from "../menuLocale";
import { menuLabel } from "../menuLocale";
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
	locale: MenuLocale | (() => MenuLocale),
): DesktopQuitCoordinator {
	// The menu language can change while the app runs, so the dialogs read it at the moment they open.
	const currentLocale = typeof locale === "function" ? locale : () => locale;
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
				title: menuLabel(currentLocale(), "Could not restart"),
				message: menuLabel(currentLocale(), "Could not restart to install the update"),
				// The detail is the host's own diagnostic text, not product copy.
				detail: message,
				buttons: [menuLabel(currentLocale(), "QuitApp")],
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
