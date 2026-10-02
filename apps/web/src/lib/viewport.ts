import { useSyncExternalStore } from "react";

const PHONE_QUERIES = ["(pointer: coarse)", "(max-width: 767px)"] as const;

function mediaQueries(): MediaQueryList[] {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") return [];
	return PHONE_QUERIES.map((query) => window.matchMedia(query));
}

export function isPhoneViewport(): boolean {
	return mediaQueries().some((query) => query.matches);
}

function subscribePhoneViewport(onChange: () => void): () => void {
	const queries = mediaQueries();
	for (const query of queries) query.addEventListener("change", onChange);
	return () => {
		for (const query of queries) query.removeEventListener("change", onChange);
	};
}

export function usePhoneViewport(): boolean {
	return useSyncExternalStore(subscribePhoneViewport, isPhoneViewport, () => false);
}
