import type { AppConfigUpdate } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getTransport } from "@/transport";

type QueuedSave = { config: AppConfigUpdate; settle: ((saved: boolean) => void)[] };

export function useAnalyticsConsent() {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const pendingRef = useRef(false);
	const queuedRef = useRef<QueuedSave | null>(null);

	const persist: (config: AppConfigUpdate) => Promise<boolean> = useCallback(
		(config) =>
			new Promise<boolean>((resolve) => {
				if (pendingRef.current) {
					queuedRef.current = { config, settle: [...(queuedRef.current?.settle ?? []), resolve] };
					return;
				}
				const run = (job: QueuedSave) => {
					pendingRef.current = true;
					setPending(true);
					setError(null);
					void getTransport()
						.request("settings.update", { config: job.config })
						.then(
							() => true,
							() => {
								setError(t("panels.analyticsConsent.saveFailed"));
								return false;
							},
						)
						.then((saved) => {
							for (const settle of job.settle) settle(saved);
							pendingRef.current = false;
							const queued = queuedRef.current;
							queuedRef.current = null;
							if (queued) run(queued);
							else setPending(false);
						});
				};
				run({ config, settle: [resolve] });
			}),
		[],
	);

	const save = useCallback(
		(analyticsEnabled: boolean) => persist({ analyticsEnabled, analyticsConsentConfirmed: true }),
		[persist],
	);
	const prime = useCallback(() => persist({ analyticsEnabled: true }), [persist]);

	return { pending, error, save, prime };
}

export function useConsentDraft() {
	const [draft, setDraft] = useState(true);
	const primed = useRef(false);
	const { pending, error, save, prime } = useAnalyticsConsent();

	useEffect(() => {
		if (primed.current) return;
		primed.current = true;
		void prime();
	}, [prime]);

	const toggle = (enabled: boolean) => {
		setDraft(enabled);
		if (!enabled) void save(false);
	};

	return { draft, toggle, pending, error, confirm: () => save(draft) };
}
