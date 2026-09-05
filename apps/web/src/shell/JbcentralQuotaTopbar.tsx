import {
	isJbcentralConnected,
	JBCENTRAL_QUOTA_PROTOCOL_VERSION,
	type JbcentralQuotaSnapshot,
} from "@thinkrail/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store";
import { getTransport } from "@/transport";
import {
	JbcentralQuotaIndicator,
	type JbcentralQuotaViewSnapshot,
} from "./JbcentralQuotaIndicator";
import { type JbcentralQuotaPolling, startJbcentralQuotaPolling } from "./jbcentralQuota";

function transportFailureSnapshot(current: JbcentralQuotaViewSnapshot): JbcentralQuotaViewSnapshot {
	if (current.state === "available" || current.state === "stale") {
		return { ...current, state: "stale" };
	}
	return { state: "unavailable" };
}

export function JbcentralQuotaTopbar() {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const connectionStatus = useAppStore((state) => state.status);
	const providerVersion = useAppStore((state) => state.providerVersion);
	const enabled = useAppStore((state) => state.jbcentralQuotaEnabled);
	const refreshSeconds = useAppStore((state) => state.jbcentralQuotaRefreshSeconds);
	const [visible, setVisible] = useState(
		() => typeof document === "undefined" || document.visibilityState === "visible",
	);
	const [centralConnected, setCentralConnected] = useState(false);
	const [snapshot, setSnapshot] = useState<JbcentralQuotaViewSnapshot>({ state: "hidden" });
	const pollingRef = useRef<JbcentralQuotaPolling | null>(null);
	const supported = protocolVersion !== null && protocolVersion >= JBCENTRAL_QUOTA_PROTOCOL_VERSION;

	useEffect(() => {
		const update = () => setVisible(document.visibilityState === "visible");
		document.addEventListener("visibilitychange", update);
		return () => document.removeEventListener("visibilitychange", update);
	}, []);

	useEffect(() => {
		let current = true;
		if (!supported || !enabled || connectionStatus !== "connected" || !visible) {
			setCentralConnected(false);
			setSnapshot({ state: "hidden" });
			return () => {
				current = false;
			};
		}

		setCentralConnected(false);
		setSnapshot({ state: "hidden" });
		void getTransport()
			.request("provider.status", {})
			.then((report) => {
				if (!current) return;
				const healthy = isJbcentralConnected(report.jbcentral);
				setCentralConnected(healthy);
				setSnapshot(healthy ? { state: "loading" } : { state: "hidden" });
			})
			.catch(() => {
				if (!current) return;
				setCentralConnected(false);
				setSnapshot({ state: "hidden" });
			});
		return () => {
			current = false;
		};
	}, [connectionStatus, enabled, providerVersion, supported, visible]);

	useEffect(() => {
		pollingRef.current?.stop();
		pollingRef.current = null;
		if (!centralConnected || !visible || !enabled || connectionStatus !== "connected") return;

		const polling = startJbcentralQuotaPolling({
			intervalMs: refreshSeconds * 1_000,
			request: (force): Promise<JbcentralQuotaSnapshot> =>
				getTransport().request("provider.jbcentralQuota", force ? { force: true } : {}),
			onSnapshot: setSnapshot,
			onError: () => setSnapshot(transportFailureSnapshot),
		});
		pollingRef.current = polling;
		return () => {
			polling.stop();
			if (pollingRef.current === polling) pollingRef.current = null;
		};
	}, [centralConnected, connectionStatus, enabled, refreshSeconds, visible]);

	const retry = useCallback(() => pollingRef.current?.retry(), []);
	return <JbcentralQuotaIndicator snapshot={snapshot} onRetry={retry} />;
}
