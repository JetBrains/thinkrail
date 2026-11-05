import { RiCloseLine, RiQrScan2Line } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import type { SavedHost } from "@thinkrail/remote-client";
import { Button, IconButton } from "@thinkrail/ui/button";
import type { PairState } from "./App";
import { failureText, type HostFailure, recoveryOf } from "./hostStatus";
import { usePairing } from "./PairForm";

/**
 * A computer the phone cannot use right now, in place of its projects: what went wrong, the one action that
 * fixes it, and a close button. Pairing again scans a new QR right here; when the computer revoked this phone,
 * closing forgets it (it is of no use any more), otherwise closing only hides the banner until it fails again.
 */
export function HostBanner({
	host,
	failure,
	pair,
	onPair,
	onReconnect,
	onForget,
	onDismiss,
}: {
	host: SavedHost;
	failure: HostFailure;
	pair: PairState;
	onPair: (link: string) => Promise<boolean>;
	onReconnect: () => void;
	onForget: () => void;
	onDismiss: () => void;
}) {
	const t = useT();
	const pairing = usePairing(pair, onPair);
	const recovery = recoveryOf(failure);
	return (
		<div
			role="status"
			data-testid="host-banner"
			data-recovery={recovery}
			className="flex flex-col gap-8 border-b border-feedback-warning-muted bg-feedback-warning-subtle py-8 pr-4 pl-16"
		>
			<div className="flex items-start gap-8">
				<p className="m-0 min-w-0 flex-1 pt-4 text-feedback-warning tr-text-metadata">
					{t("mobile.projects.unreachable", { host: host.label, reason: failureText(t, failure) })}
				</p>
				<IconButton
					size="l"
					className="size-touch shrink-0"
					icon={RiCloseLine}
					label={recovery === "repair" ? t("mobile.hosts.forgetNow") : t("common.dismiss")}
					onClick={recovery === "repair" ? onForget : onDismiss}
				/>
			</div>
			{recovery === "none" ? null : (
				<div className="flex pr-12">
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
				<p role="alert" className="m-0 pr-12 text-feedback-error tr-text-metadata">
					{pairing.problem}
				</p>
			) : null}
		</div>
	);
}
