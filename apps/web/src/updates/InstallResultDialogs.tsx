import {
	RiAlertLine as Alert,
	RiDownloadCloud2Line as DownloadCloud,
	RiExternalLinkLine as ExternalLink,
	RiRefreshLine as Refresh,
	RiRestartLine as Restart,
} from "@remixicon/react";
import type { NativeUpdateInstallResult } from "@thinkrail/contracts";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { useState } from "react";
import { InstallLog, InstallLogToggle } from "./InstallLog";
import { type InstallRecovery, installFailureCopy, releaseNotesUrl } from "./installCopy";

export function InstallFailedDialog({
	result,
	currentVersion,
	recovery,
	onRecover,
	onLater,
}: {
	result: NativeUpdateInstallResult;
	currentVersion: string;
	recovery: InstallRecovery | null;
	onRecover(kind: "install" | "download" | "check"): void;
	onLater(): void;
}) {
	const [showLog, setShowLog] = useState(false);
	const copy = installFailureCopy(result);
	const RecoverIcon =
		recovery?.kind === "install"
			? Restart
			: recovery?.kind === "download"
				? DownloadCloud
				: Refresh;

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onLater();
			}}
		>
			<DialogContent
				role="alertdialog"
				hideClose
				data-testid="update-install-failed"
				data-failed-step={result.failedStep ?? result.outcome}
				className="max-w-[32rem]"
			>
				<DialogHeader>
					<DialogTitle>The update didn't install</DialogTitle>
					<DialogDescription>
						{result.outcome === "unreported"
							? `ThinkRail is still on version ${currentVersion}.`
							: `ThinkRail restored version ${currentVersion}, so nothing was lost.`}
					</DialogDescription>
				</DialogHeader>
				<div className="flex gap-8 rounded-sm border border-feedback-error-muted bg-feedback-error-subtle p-8">
					<Alert aria-hidden="true" className="mt-2 size-14 shrink-0 text-feedback-error" />
					<div className="flex min-w-0 flex-col gap-2">
						<p data-testid="update-install-cause" className="tr-title-compact text-text-default">
							{copy.cause}
						</p>
						<p className="text-text-muted tr-text-ui">{copy.advice}</p>
					</div>
				</div>
				{recovery?.detail ? (
					<p className="text-text-muted tr-text-metadata">{recovery.detail}</p>
				) : null}
				<div className="flex flex-col gap-8">
					<div>
						<InstallLogToggle open={showLog} onOpenChange={setShowLog} />
					</div>
					{showLog ? (
						<InstallLog
							entries={result.log}
							note={
								result.detail
									? `Installer result: ${result.failedStep ?? "unknown step"} · ${result.detail}`
									: undefined
							}
						/>
					) : null}
				</div>
				<DialogFooter>
					<Button variant="outline" data-testid="update-install-later" onClick={onLater}>
						Later
					</Button>
					{recovery ? (
						<Button
							data-testid="update-install-recover"
							data-recovery={recovery.kind}
							disabled={recovery.kind === "pending"}
							onClick={() => {
								if (recovery.kind !== "pending") onRecover(recovery.kind);
							}}
						>
							<RecoverIcon className="size-14" />
							{recovery.label}
						</Button>
					) : null}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function InstallDetailsDialog({
	result,
	onClose,
}: {
	result: NativeUpdateInstallResult;
	onClose(): void;
}) {
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent data-testid="update-install-details" className="max-w-[32rem]">
				<DialogHeader>
					<DialogTitle>ThinkRail {result.toVersion} is installed</DialogTitle>
					<DialogDescription>
						{result.fromVersion
							? `Updated from ${result.fromVersion}.`
							: "The update finished and ThinkRail restarted."}
					</DialogDescription>
				</DialogHeader>
				<InstallLog entries={result.log} />
				<DialogFooter>
					<a
						href={releaseNotesUrl(result.toVersion)}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-4 text-primary tr-text-ui"
					>
						What's new
						<ExternalLink aria-hidden="true" className="size-14" />
					</a>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
