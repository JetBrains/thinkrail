import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
	window.addEventListener("focus", onChange);
	window.addEventListener("blur", onChange);
	document.addEventListener("visibilitychange", onChange);
	return () => {
		window.removeEventListener("focus", onChange);
		window.removeEventListener("blur", onChange);
		document.removeEventListener("visibilitychange", onChange);
	};
}

function windowFocused(): boolean {
	return document.visibilityState === "visible" && document.hasFocus();
}

export function useWindowFocused(): boolean {
	return useSyncExternalStore(subscribe, windowFocused, () => false);
}
