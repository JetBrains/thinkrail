import { useAction, useChannel } from "@thinkrail/ext/view";
import { useCallback, useEffect, useState } from "react";
import {
	isRunSummary,
	isWorkflowRun,
	RUNS_KEY,
	type RunSummary,
	runKey,
	type WorkflowRun,
} from "./model";

export const useRuns = (): RunSummary[] | undefined => {
	const value = useChannel<unknown>(RUNS_KEY);
	return Array.isArray(value) ? value.filter(isRunSummary) : undefined;
};

export const useRun = (runId: string | undefined): WorkflowRun | undefined => {
	const value = useChannel<unknown>(runId ? runKey(runId) : "");
	return runId && isWorkflowRun(value) ? value : undefined;
};

export const useNow = (tickMs: number, active = true) => {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		const timer = setInterval(() => setNow(Date.now()), tickMs);
		return () => clearInterval(timer);
	}, [tickMs, active]);
	return now;
};

export const useCancel = () => {
	const cancel = useAction("cancel");
	return useCallback((runId: string) => void cancel({ runId }).catch(() => {}), [cancel]);
};

export const useForget = () => {
	const forget = useAction("forget");
	return useCallback((runId: string) => void forget({ runId }).catch(() => {}), [forget]);
};
