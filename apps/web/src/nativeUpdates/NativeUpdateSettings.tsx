import {
	RiDownloadCloud2Line as DownloadCloud,
	RiRefreshLine as Refresh,
	RiRestartLine as Restart,
} from "@remixicon/react";
import { Button } from "../components/ui/button";
import type { NativeUpdatePresentation, NativeUpdateTone } from "./presentation";
import { useNativeUpdates } from "./useNativeUpdates";

const TONE_CLASS: Record<NativeUpdateTone, string> = {
	neutral: "text-text-muted",
	active: "text-feedback-info",
	ready: "text-primary",
	error: "text-feedback-error",
};

interface NativeUpdateSettingsViewProps {
	presentation: NativeUpdatePresentation;
	onCheck(): void;
	onRestart(): void;
	onLater(): void;
}

export function NativeUpdateSettingsView({
	presentation,
	onCheck,
	onRestart,
	onLater,
}: NativeUpdateSettingsViewProps) {
	return (
		<section data-testid="settings-updates" className="flex flex-col gap-16">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Software updates</h3>
				<p className="text-text-muted tr-text-metadata">
					Updates download in the background and install only when you choose Restart to Update.
				</p>
			</div>

			<div
				data-testid="native-update-status"
				data-status={presentation.status}
				className="flex flex-col gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg p-12"
			>
				<div className="flex items-start gap-8">
					<DownloadCloud
						aria-hidden="true"
						className={`mt-2 size-16 shrink-0 ${TONE_CLASS[presentation.tone]}`}
					/>
					<div className="min-w-0 flex-1">
						<p className="tr-title-compact text-text-default">{presentation.title}</p>
						<p className="text-text-muted tr-text-metadata">{presentation.detail}</p>
					</div>
				</div>

				{presentation.progressLabel ? (
					<div className="flex flex-col gap-4">
						<progress
							max={100}
							{...(presentation.progress === null ? {} : { value: presentation.progress })}
							aria-label={presentation.progressLabel}
							className="h-4 w-full accent-primary"
						/>
						<span className="text-text-muted tr-text-metadata">{presentation.progressLabel}</span>
					</div>
				) : null}

				{presentation.error ? (
					<p
						data-testid="native-update-error"
						role="alert"
						className="text-feedback-error tr-text-ui"
					>
						{presentation.error}
					</p>
				) : null}

				<div className="flex flex-wrap items-center justify-between gap-8 border-border-default border-t pt-8">
					<span data-testid="native-update-version" className="text-text-muted tr-text-metadata">
						{presentation.versionLabel}
					</span>
					{presentation.availableVersion ? (
						<span className="text-text-muted tr-text-metadata">
							Available: {presentation.availableVersion}
						</span>
					) : null}
				</div>
			</div>

			<div className="flex flex-wrap justify-end gap-8">
				{presentation.checkLabel ? (
					<Button
						variant="outline"
						data-testid="native-update-check"
						disabled={presentation.checkDisabled}
						onClick={onCheck}
					>
						<Refresh className="size-14" />
						{presentation.checkLabel}
					</Button>
				) : null}
				{presentation.showLater ? (
					<Button
						variant="outline"
						data-testid="native-update-later"
						disabled={presentation.restartDisabled}
						onClick={onLater}
					>
						Later
					</Button>
				) : null}
				{presentation.restartLabel ? (
					<Button
						data-testid="native-update-restart"
						disabled={presentation.restartDisabled}
						onClick={onRestart}
					>
						<Restart className="size-14" />
						{presentation.restartLabel}
					</Button>
				) : null}
			</div>

			{presentation.ready ? (
				<p className="text-text-muted tr-text-metadata">
					Later keeps this update ready. Quitting ThinkRail normally does not install it.
				</p>
			) : null}
		</section>
	);
}

export function NativeUpdateSettings({ onLater }: { onLater(): void }) {
	const updates = useNativeUpdates();
	if (!updates) return null;
	return (
		<NativeUpdateSettingsView
			presentation={updates.presentation}
			onCheck={updates.checkForUpdates}
			onRestart={updates.restartToUpdate}
			onLater={onLater}
		/>
	);
}
