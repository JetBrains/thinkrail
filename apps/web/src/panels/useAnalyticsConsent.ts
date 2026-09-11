import { useRef, useState } from "react";
import { getTransport } from "@/transport";

export function useAnalyticsConsent() {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const pendingRef = useRef(false);

	const save = (analyticsEnabled: boolean) => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		setError(null);
		void getTransport()
			.request("settings.update", {
				config: { analyticsEnabled, analyticsConsentConfirmed: true },
			})
			.catch(() => setError("Couldn't save your choice. Please try again."))
			.finally(() => {
				pendingRef.current = false;
				setPending(false);
			});
	};

	return { pending, error, save };
}
