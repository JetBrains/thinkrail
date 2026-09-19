import type { AppConfigUpdate } from "@thinkrail/contracts";
import { useCallback, useRef, useState } from "react";
import { getTransport } from "@/transport";

export function useAnalyticsConsent() {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const pendingRef = useRef(false);
	const queuedRef = useRef<AppConfigUpdate | null>(null);

	const persist: (config: AppConfigUpdate) => void = useCallback((config) => {
		if (pendingRef.current) {
			queuedRef.current = config;
			return;
		}
		pendingRef.current = true;
		setPending(true);
		setError(null);
		void getTransport()
			.request("settings.update", { config })
			.catch(() => setError("Couldn't save your choice. Please try again."))
			.finally(() => {
				pendingRef.current = false;
				const queued = queuedRef.current;
				queuedRef.current = null;
				if (queued) persist(queued);
				else setPending(false);
			});
	}, []);

	const save = useCallback(
		(analyticsEnabled: boolean) => {
			persist({ analyticsEnabled, analyticsConsentConfirmed: true });
		},
		[persist],
	);
	const prime = useCallback(() => {
		persist({ analyticsEnabled: true });
	}, [persist]);

	return { pending, error, save, prime };
}
