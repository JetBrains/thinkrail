import { RiQrScan2Line } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { type HostFailure, recoveryOf } from "@thinkrail/remote-client";
import { Button } from "@thinkrail/ui/button";
import type { PairState } from "./App";
import { failureText } from "./hostStatus";
import { usePairing } from "./PairForm";

/**
 * Why the computer's screen cannot show its projects right now, and the one action that fixes it: scan a new
 * QR right here when the phone must pair again, Reconnect for a passing failure, nothing when only an app
 * update helps. Forgetting it lives in the screen's ⋯.
 */
export function HostBanner({
	failure,
	pair,
	onPair,
	onReconnect,
}: {
	failure: HostFailure;
	pair: PairState;
	onPair: (link: string) => Promise<boolean>;
	onReconnect: () => void;
}) {
	const t = useT();
	const pairing = usePairing(pair, onPair);
	const recovery = recoveryOf(failure);
	return (
		<div
			role="status"
			data-testid="host-banner"
			data-recovery={recovery}
			className="flex flex-col gap-8 border-b border-feedback-warning-muted bg-feedback-warning-subtle px-16 py-12"
		>
			<p className="m-0 text-feedback-warning tr-text-metadata">{failureText(t, failure)}</p>
			{recovery === "none" ? null : (
				<div className="flex">
					{recovery === "repair" ? (
						<Button
							variant="outline"
							tone="warning"
							className="h-touch rounded-md"
							iconLeft={RiQrScan2Line}
							loading={pairing.scanning}
							disabled={pairing.pairing}
							onClick={() => void pairing.scan()}
						>
							{t("mobile.pair.scan")}
						</Button>
					) : (
						<Button
							variant="outline"
							tone="warning"
							className="h-touch rounded-md"
							onClick={onReconnect}
						>
							{t("mobile.hosts.reconnect")}
						</Button>
					)}
				</div>
			)}
			{pairing.problem && recovery === "repair" ? (
				<p role="alert" className="m-0 text-feedback-error tr-text-metadata">
					{pairing.problem}
				</p>
			) : null}
		</div>
	);
}
