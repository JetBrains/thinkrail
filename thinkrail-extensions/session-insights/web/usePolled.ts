import { useEffect, useEffectEvent, useState } from "react";
import { type ListFailure, listFailure } from "./load";
import { retryWithBackoff } from "./retry";
import { VersionSkew } from "./session/api";

export type Polled<T> =
	| { kind: "loading" }
	| { kind: "ready"; value: T }
	| { kind: "version" }
	| { kind: "error"; failure: ListFailure };

interface Settled<T> {
	key: string;
	view: Polled<T>;
}

/**
 * A query for `key` (scope, options and attempt), only while `enabled`, re-asked with a backoff while
 * `pending(answer)` and only while the document is visible (a poll due in a hidden tab waits for its
 * return). While a new key loads, the last ready answer stays with `busy`, so an option never swaps the
 * view for a skeleton.
 */
export function usePolled<T>(
	key: string,
	enabled: boolean,
	run: (signal: AbortSignal) => Promise<T>,
	pending: (value: T) => boolean,
): { view: Polled<T>; busy: boolean } {
	const [settled, setSettled] = useState<Settled<T> | null>(null);
	const [last, setLast] = useState<T | null>(null);
	const request = useEffectEvent(run);
	const again = useEffectEvent(pending);
	useEffect(() => {
		if (!enabled) return;
		const controller = new AbortController();
		const settle = (view: Polled<T>) => setSettled({ key, view });
		const ask = () => {
			request(controller.signal).then(
				(value) => {
					if (controller.signal.aborted) return;
					settle({ kind: "ready", value });
					setLast(value);
					if (again(value)) retry.again();
				},
				(error: unknown) => {
					if (controller.signal.aborted) return;
					settle(
						error instanceof VersionSkew
							? { kind: "version" }
							: { kind: "error", failure: listFailure(error) },
					);
				},
			);
		};
		const retry = retryWithBackoff(ask);
		ask();
		return () => {
			controller.abort();
			retry.stop();
		};
	}, [enabled, key]);
	const current = settled?.key === key ? settled.view : null;
	if (current) return { view: current, busy: false };
	return last === null
		? { view: { kind: "loading" }, busy: false }
		: { view: { kind: "ready", value: last }, busy: true };
}
