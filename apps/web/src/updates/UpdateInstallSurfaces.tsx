import type { NativeUpdateInstallResult } from "@thinkrail/contracts";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store";
import { InstallDialog } from "./InstallDialog";
import { InstallDetailsDialog, InstallFailedDialog } from "./InstallResultDialogs";
import { installRecovery } from "./installCopy";
import type { UpdatesController } from "./useUpdates";

function resultKey(result: NativeUpdateInstallResult): string {
	return [result.outcome, result.fromVersion, result.toVersion, result.log.at(-1)?.at].join("|");
}

export function UpdateInstallSurfaces({ updates }: { updates: UpdatesController | null }) {
	const native = updates?.source === "native" ? updates : null;
	const [details, setDetails] = useState<NativeUpdateInstallResult | null>(null);
	const announced = useRef<string | null>(null);
	const lastInstall = native?.state.lastInstall ?? null;
	const installed = lastInstall?.outcome === "installed" ? lastInstall : null;
	const dismiss = native?.dismissInstallResult;

	useEffect(() => {
		if (!installed || !dismiss) return;
		const key = resultKey(installed);
		if (announced.current === key) return;
		announced.current = key;
		useAppStore.getState().pushToast({
			variant: "success",
			title: `Updated to ${installed.toVersion}`,
			message: installed.fromVersion
				? `from ${installed.fromVersion}`
				: "ThinkRail restarted on the new version.",
			action: { label: "Details", onClick: () => setDetails(installed) },
		});
		dismiss();
	}, [installed, dismiss]);

	if (!native) return null;
	const failed = lastInstall && lastInstall.outcome !== "installed" ? lastInstall : null;
	return (
		<>
			<InstallDialog state={native.state} />
			{failed ? (
				<InstallFailedDialog
					result={failed}
					currentVersion={native.state.version}
					recovery={installRecovery(native.state)}
					onRecover={(kind) => {
						if (kind === "install") native.restartToUpdate();
						else if (kind === "download") native.downloadUpdate();
						else native.checkForUpdates();
					}}
					onLater={native.dismissInstallResult}
				/>
			) : null}
			{details ? <InstallDetailsDialog result={details} onClose={() => setDetails(null)} /> : null}
		</>
	);
}
