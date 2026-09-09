export {
	createNativeUpdateController,
	isStrictlyNewerVersion,
	type NativeUpdateController,
	type NativeUpdateControllerDependencies,
	type NativeUpdaterDependency,
	type NativeUpdaterInfo,
	type NativeUpdaterStatusEntry,
} from "./controller";
export {
	createElectrobunQuitCoordinator,
	createElectrobunUpdateController,
	type ElectrobunUpdateControllerOptions,
} from "./electrobunAdapter";
export {
	DESKTOP_UPDATE_BASE_URL,
	hasDesktopArtifactTestSeam,
	type NativeUpdateEnablement,
	nativeUpdatesEnabled,
} from "./enablement";
export {
	createDesktopQuitCoordinator,
	type DesktopBeforeQuitEvent,
	type DesktopQuitCoordinator,
	type DesktopQuitCoordinatorDependencies,
} from "./quitCoordinator";
