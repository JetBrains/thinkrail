import { useEffect, useRef } from "react";

export const reasonOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** Runs one task at a time: a call while one is in flight is dropped (null), so a second tap cannot fire it twice. */
export function singleFlight(onPending: (pending: boolean) => void = () => {}) {
	let running = false;
	return <T>(task: () => Promise<T>): Promise<T> | null => {
		if (running) return null;
		running = true;
		onPending(true);
		return task().finally(() => {
			running = false;
			onPending(false);
		});
	};
}

/** False once the screen left, so a late answer does not navigate from wherever the user went since. */
export function useMounted(): { readonly current: boolean } {
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	return mounted;
}
