import { useEffect, useEffectEvent, useState } from "react";
import { retryWithBackoff } from "./retry";
import { VersionSkew } from "./session/api";

export type Query<T> =
	| { kind: "loading" }
	| { kind: "ready"; value: T }
	| { kind: "version" }
	| { kind: "failed" };

/**
 * One async load per `key` (`null`: not asked yet): a new key aborts the previous load and reads
 * `loading` until its own answer lands; `progress` shows a paged load's growing prefix. An answer
 * `again` holds pending (the host's index has not reached the session yet) is asked again with the
 * polls' backoff, only while the document is visible.
 */
export function useKeyedQuery<T>(
	key: string | null,
	run: (signal: AbortSignal, progress: (value: T) => void) => Promise<T>,
	again?: (value: T) => boolean,
): Query<T> {
	const [settled, setSettled] = useState<{ key: string; query: Query<T> } | null>(null);
	const request = useEffectEvent(run);
	const pending = useEffectEvent((value: T) => again?.(value) === true);
	useEffect(() => {
		if (key === null) return;
		const controller = new AbortController();
		const settle = (query: Query<T>) => {
			if (!controller.signal.aborted) setSettled({ key, query });
		};
		const ask = () => {
			request(controller.signal, (value) => settle({ kind: "ready", value })).then(
				(value) => {
					settle({ kind: "ready", value });
					if (!controller.signal.aborted && pending(value)) retry.again();
				},
				(error: unknown) => settle({ kind: error instanceof VersionSkew ? "version" : "failed" }),
			);
		};
		const retry = retryWithBackoff(ask);
		ask();
		return () => {
			controller.abort();
			retry.stop();
		};
	}, [key]);
	return key !== null && settled?.key === key ? settled.query : { kind: "loading" };
}
