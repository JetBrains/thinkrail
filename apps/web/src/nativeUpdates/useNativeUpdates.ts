import { useSyncExternalStore } from "react";
import { getNativeUpdateController, type NativeUpdateControllerSnapshot } from "./controller";
import { deriveNativeUpdatePresentation, type NativeUpdatePresentation } from "./presentation";

export interface NativeUpdates {
	presentation: NativeUpdatePresentation;
	checkForUpdates(): void;
	restartToUpdate(): void;
}

const UNAVAILABLE_SNAPSHOT: NativeUpdateControllerSnapshot = Object.freeze({
	state: null,
	pendingAction: null,
	actionError: null,
});
const unavailableSnapshot = () => UNAVAILABLE_SNAPSHOT;
const unavailableSubscribe = () => () => {};

export function useNativeUpdates(): NativeUpdates | null {
	const controller = getNativeUpdateController();
	const getSnapshot = controller?.getSnapshot ?? unavailableSnapshot;
	const subscribe = controller?.subscribe ?? unavailableSubscribe;
	const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	if (!controller) return null;
	return {
		presentation: deriveNativeUpdatePresentation(snapshot),
		checkForUpdates: () => controller.checkForUpdates(),
		restartToUpdate: () => controller.restartToUpdate(),
	};
}
