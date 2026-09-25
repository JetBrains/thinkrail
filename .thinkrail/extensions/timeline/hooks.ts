import { useAction } from "@thinkrail/ext/view";
import { useEffect, useState } from "react";

const TICK_MS = 250;

export const useNow = (ticking: boolean) => {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!ticking) return;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), TICK_MS);
		return () => clearInterval(timer);
	}, [ticking]);
	return now;
};

export const useWatch = (sessionId: string | undefined) => {
	const watch = useAction("watch");
	useEffect(() => {
		if (sessionId) void watch().catch(() => {});
	}, [sessionId, watch]);
};
