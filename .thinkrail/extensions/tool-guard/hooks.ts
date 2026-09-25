import { useChannel } from "@thinkrail/ext/view";
import { useEffect, useState } from "react";
import type { Decision, RuleView } from "./model";

const TICK_MS = 15_000;

export const useLog = () => useChannel<Decision[]>("log") ?? [];

export const useRules = () => useChannel<RuleView[]>("rules") ?? [];

export const useNow = () => {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), TICK_MS);
		return () => clearInterval(timer);
	}, []);
	return now;
};
