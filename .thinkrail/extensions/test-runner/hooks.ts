import { useAction, useChannel } from "@thinkrail/ext/view";
import { useCallback, useEffect, useState } from "react";
import { channelKey, isRunReply, type RunReply, type TestsState } from "./model";

export const useTests = (workspaceId: string | undefined) =>
	useChannel<TestsState>(workspaceId ? channelKey(workspaceId) : "");

export const useNow = (tickMs: number) => {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), tickMs);
		return () => clearInterval(timer);
	}, [tickMs]);
	return now;
};

export const useRunner = () => {
	const runAction = useAction("run");
	const cancelAction = useAction("cancel");
	const [reply, setReply] = useState<RunReply | undefined>();
	const run = useCallback(
		(filter: string) => {
			setReply(undefined);
			void runAction({ filter })
				.then((value) =>
					setReply(isRunReply(value) ? value : { started: false, reason: "Unexpected reply." }),
				)
				.catch((error: unknown) => setReply({ started: false, reason: String(error) }));
		},
		[runAction],
	);
	const cancel = useCallback(() => void cancelAction().catch(() => {}), [cancelAction]);
	return { run, cancel, reply };
};
