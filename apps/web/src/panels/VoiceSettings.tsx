import type { SpeechModel, SpeechStatus } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import { dictationShortcutLabel, speechErrorKey } from "@/speech";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { SegmentedControl } from "./SegmentedControl";
import { SettingsNotice } from "./SettingsNotice";
import { SETTINGS_ROWS_CONTAINER, SettingsRow } from "./SettingsRow";
import { SettingsSwitch } from "./SettingsSwitch";

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
	if (install.status === "ready") return <>{t("settings.voice.status.ready")}</>;
	return (
		<>
			{t("settings.voice.status.notInstalled", {
				size: megabytes(status.downloadBytes.multilingual),
			})}
		</>
	);
}

export function VoiceSettings() {
	const t = useT();
	const status = useAppStore((s) => s.speech);
	const enabled = useAppStore((s) => s.voiceInputEnabled);
	const [removing, setRemoving] = useState(false);
	if (!status) return null;

	const failed = () => {
		toast.error(t("settings.voice.actionFailed"));
	};
	const setEnabled = (voiceInputEnabled: boolean) =>
		getTransport().request("settings.update", { config: { voiceInputEnabled } }).catch(failed);
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

	return (
		<div data-testid="settings-voice" className={SETTINGS_ROWS_CONTAINER}>
			<SettingsRow
				label={t("settings.voice.enable")}
				description={
					enabled ? t("settings.voice.enableDescription") : t("settings.voice.disabledDescription")
				}
				control={
					<SettingsSwitch
						checked={enabled}
						label={t("settings.voice.enable")}
						testId="settings-voice-toggle"
						onChange={(next) => void setEnabled(next)}
					/>
				}
			/>
			{enabled || installing ? (
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
									: t("settings.voice.download")}
							</Button>
						)
					}
				/>
			) : null}
			{enabled ? (
				<>
					<SettingsRow
						label={t("settings.voice.language")}
						description={t("settings.voice.languageDescription")}
						testId="settings-voice-language"
						control={
							<SegmentedControl<SpeechModel>
								name="speech-model"
								label={t("settings.voice.language")}
								value={model}
								disabled={installing}
								options={[
									{
										id: "multilingual",
										label: t("settings.voice.language.all"),
										testId: "settings-voice-language-all",
									},
									{
										id: "english",
										label: t("settings.voice.language.english"),
										testId: "settings-voice-language-english",
									},
								]}
								onSelect={(next) => {
									if (next !== model) void installModel(next);
								}}
							/>
						}
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
				</>
			) : null}
			{status.diskBytes > 0 ? (
				<SettingsRow
					label={t("settings.voice.delete")}
					description={t("settings.voice.deleteDescription", {
						size: megabytes(status.diskBytes),
					})}
					testId="settings-voice-files"
					control={
						<Button
							variant="outline"
							size="m"
							tone="danger"
							data-testid="settings-voice-delete"
							disabled={removing}
							onClick={remove}
						>
							{t("settings.voice.deleteButton")}
						</Button>
					}
				/>
			) : null}
		</div>
	);
}
