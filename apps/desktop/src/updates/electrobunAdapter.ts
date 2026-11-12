import { join } from "node:path";
import { Updater, Utils } from "electrobun/main";
import { desktopError } from "../errorReporting";
import type { DesktopDialogLabels } from "../nativeLabels";
import {
	createNativeUpdateController,
	type NativeUpdateController,
	type NativeUpdaterDependency,
} from "./controller";
import { hasDesktopArtifactTestSeam, nativeUpdatesEnabled } from "./enablement";
import { createUpdateJournalStore, UPDATE_JOURNAL_FILE } from "./journal";
import { createDesktopQuitCoordinator, type DesktopQuitCoordinator } from "./quitCoordinator";

export interface ElectrobunUpdateControllerOptions {
	isPackaged: boolean;
	version: string;
	channel: string;
	platform: NodeJS.Platform;
	arch: string;
	userData: string;
	restartToUpdate(): Promise<boolean>;
}

function updateJournal(userData: string) {
	return createUpdateJournalStore(join(userData, UPDATE_JOURNAL_FILE), (error) => {
		desktopError("updates", "update journal failed", error);
	});
}

export function readPendingInstallVersion(userData: string): string | null {
	const journal = updateJournal(userData).read();
	return journal?.state === "pending" ? journal.toVersion : null;
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
	dialogLabels: () => DesktopDialogLabels,
): DesktopQuitCoordinator {
	return createDesktopQuitCoordinator({
		shutdown,
		quit: () => {
			Utils.quit();
		},
		applyUpdate: () => Updater.applyUpdate(),
		getUpdateError: () => Updater.updateInfo().error,
		reportUpdateFailure: async (message) => {
			const labels = dialogLabels();
			await Utils.showMessageBox({
				type: "error",
				title: labels["desktop.dialog.updateRestartFailedTitle"],
				message: labels["desktop.dialog.updateRestartFailed"],
				detail: message,
				buttons: [labels["desktop.dialog.quit"]],
			});
		},
		reportLifecycleError: (error) => {
			desktopError("updates", "update lifecycle failed", error);
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
		journal: updateJournal(options.userData),
	});
}
