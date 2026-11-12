import { useCallback, useSyncExternalStore } from "react";

const PHONE_QUERY = "(pointer: coarse), (max-width: 767px)";

function mediaQuery(query: string): MediaQueryList | null {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
	return window.matchMedia(query);
}

function matchesMediaQuery(query: string): boolean {
	return mediaQuery(query)?.matches ?? false;
}

export function useMediaQuery(query: string): boolean {
	const subscribe = useCallback(
		(onChange: () => void) => {
			const list = mediaQuery(query);
			list?.addEventListener("change", onChange);
			return () => list?.removeEventListener("change", onChange);
		},
		[query],
	);
	const matches = useCallback(() => matchesMediaQuery(query), [query]);
	return useSyncExternalStore(subscribe, matches, () => false);
}

export function isPhoneViewport(): boolean {
	return matchesMediaQuery(PHONE_QUERY);
}

export function usePhoneViewport(): boolean {
	return useMediaQuery(PHONE_QUERY);
}
