import { useAction, useChannel } from "@thinkrail/ext/view";
import { useCallback, useEffect, useState } from "react";
import { channelKey, type FetchResult, isFetchResult, type Pulse } from "./model";

const TICK_MS = 30_000;

export const usePulse = (workspaceId: string | undefined) =>
	useChannel<Pulse>(workspaceId ? channelKey(workspaceId) : "");

export const useNow = () => {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), TICK_MS);
		return () => clearInterval(timer);
	}, []);
	return now;
};

interface FetchState {
	workspaceId: string | undefined;
	running: boolean;
	result?: FetchResult;
}

export const useFetch = (workspaceId: string | undefined) => {
	const fetchAction = useAction("fetch");
	const [state, setState] = useState<FetchState>({ workspaceId: undefined, running: false });
	const run = useCallback(() => {
		setState({ workspaceId, running: true });
		void fetchAction()
			.then((value) =>
				setState({
					workspaceId,
					running: false,
					result: isFetchResult(value)
						? value
						: { ok: false, output: "Unexpected fetch result.", at: Date.now() },
				}),
			)
			.catch((error: unknown) =>
				setState({
					workspaceId,
					running: false,
					result: { ok: false, output: String(error), at: Date.now() },
				}),
			);
	}, [fetchAction, workspaceId]);
	const current: FetchState =
		state.workspaceId === workspaceId ? state : { workspaceId, running: false };
	return { ...current, run };
};
