import { useLayoutEffect, useSyncExternalStore } from "react";

let obscuringOverlayCount = 0;
const listeners = new Set<() => void>();

function publish(next: number): void {
	obscuringOverlayCount = next;
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function obscuringOverlayIsOpen(): boolean {
	return obscuringOverlayCount > 0;
}

export function ObscuringOverlayMarker() {
	useLayoutEffect(() => {
		publish(obscuringOverlayCount + 1);
		return () => publish(Math.max(0, obscuringOverlayCount - 1));
	}, []);
	return null;
}

export function useObscuringOverlayOpen(): boolean {
	return useSyncExternalStore(subscribe, obscuringOverlayIsOpen, () => false);
}
