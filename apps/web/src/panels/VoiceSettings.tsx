import type { SpeechModel, SpeechStatus } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import { dictationShortcutLabel, speechErrorKey } from "@/speech";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { SegmentedControl } from "./SegmentedControl";
import { SettingsNotice } from "./SettingsNotice";
import { SETTINGS_ROWS_CONTAINER, SettingsRow } from "./SettingsRow";

const ENGINE_LABEL = {
	stopped: "settings.voice.engine.stopped",
	starting: "settings.voice.engine.starting",
	ready: "settings.voice.engine.ready",
	failed: "settings.voice.engine.failed",
} as const satisfies Record<SpeechStatus["engine"], MessageKey>;

function megabytes(bytes: number): string {
	return String(Math.max(1, Math.round(bytes / 1_000_000)));
}

function selectedModel(status: SpeechStatus): SpeechModel | null {
	const install = status.install;
	if (install.status === "ready") return install.model;
	if (install.status === "installing") return install.model;
	if (install.status === "failed") return install.usable ?? install.model;
	return null;
}

function StatusText({ status }: { status: SpeechStatus }) {
	const t = useT();
	const install = status.install;
	if (install.status === "installing") {
		const percent =
			install.totalBytes > 0 ? Math.floor((install.receivedBytes / install.totalBytes) * 100) : 0;
		return <>{t("settings.voice.status.installing", { percent: String(percent) })}</>;
	}
	if (install.status === "failed") {
		return <span className="text-feedback-error">{t(speechErrorKey(install.code))}</span>;
	}
	if (install.status === "ready") {
		return <>{t("settings.voice.status.ready", { engine: t(ENGINE_LABEL[status.engine]) })}</>;
	}
	return <>{t("settings.voice.status.notInstalled")}</>;
}

/** Settings → Voice: what is installed, which model, the shortcut, and removal. */
export function VoiceSettings() {
	const t = useT();
	const status = useAppStore((s) => s.speech);
	const [removing, setRemoving] = useState(false);
	if (!status) return null;

	const failed = () => {
		toast.error(t("settings.voice.actionFailed"));
	};
	const installModel = (next: SpeechModel) =>
		getTransport().request("speech.install", { model: next }).catch(failed);
	const cancelInstall = () => getTransport().request("speech.cancelInstall", {}).catch(failed);
	const remove = () => {
		setRemoving(true);
		void getTransport()
			.request("speech.remove", {})
			.catch(failed)
			.finally(() => setRemoving(false));
	};

	if (!status.supported) {
		return (
			<div data-testid="settings-voice" className={SETTINGS_ROWS_CONTAINER}>
				<SettingsNotice variant="warning" testId="settings-voice-unsupported">
					{t("speech.mic.unavailable.unsupportedPlatform")}
				</SettingsNotice>
			</div>
		);
	}

	const install = status.install;
	const installing = install.status === "installing";
	const model = selectedModel(status);
	const runtime = status.runtime;

	return (
		<div data-testid="settings-voice" className={SETTINGS_ROWS_CONTAINER}>
			<SettingsRow
				label={t("settings.voice.status")}
				description={<StatusText status={status} />}
				testId="settings-voice-status"
				control={
					installing ? (
						<Button
							variant="outline"
							size="m"
							data-testid="settings-voice-cancel"
							onClick={() => void cancelInstall()}
						>
							{t("settings.voice.cancel")}
						</Button>
					) : install.status === "ready" ? null : (
						<Button
							variant="primary"
							size="m"
							data-testid="settings-voice-install"
							onClick={() =>
								void installModel(install.status === "failed" ? install.model : "multilingual")
							}
						>
							{install.status === "failed"
								? t("speech.offer.retry")
								: t("settings.voice.install", {
										size: megabytes(status.downloadBytes.multilingual),
									})}
						</Button>
					)
				}
			/>
			<SettingsRow
				label={t("settings.voice.model")}
				description={t("settings.voice.modelDescription")}
				testId="settings-voice-model"
				control={
					<SegmentedControl<SpeechModel>
						name="speech-model"
						label={t("settings.voice.model")}
						value={model}
						disabled={installing}
						options={[
							{
								id: "multilingual",
								label: t("settings.voice.model.multilingual"),
								testId: "settings-voice-model-multilingual",
							},
							{
								id: "english",
								label: t("settings.voice.model.english"),
								testId: "settings-voice-model-english",
							},
						]}
						onSelect={(next) => {
							if (next !== model) void installModel(next);
						}}
					/>
				}
			/>
			<SettingsRow
				label={t("settings.voice.engine")}
				testId="settings-voice-runtime"
				description={
					runtime
						? runtime.source === "path"
							? t("settings.voice.runtime.path", {
									version: runtime.version,
									backend: runtime.backend,
								})
							: t("settings.voice.runtime.managed", {
									version: runtime.version,
									backend: runtime.backend,
								})
						: t("settings.voice.runtime.none")
				}
				control={null}
			/>
			<SettingsRow
				label={t("settings.voice.shortcut")}
				description={t("settings.voice.shortcutDescription")}
				control={
					<kbd className="rounded-xs bg-control-bg px-4 py-2 text-text-default tr-text-metadata">
						{dictationShortcutLabel()}
					</kbd>
				}
			/>
			<SettingsRow
				label={t("settings.voice.storage")}
				description={t("settings.voice.storageDescription", {
					size: megabytes(status.diskBytes),
				})}
				testId="settings-voice-storage"
				control={
					<Button
						variant="outline"
						size="m"
						tone="danger"
						data-testid="settings-voice-remove"
						disabled={status.diskBytes === 0 || removing}
						onClick={remove}
					>
						{t("settings.voice.remove")}
					</Button>
				}
			/>
		</div>
	);
}
