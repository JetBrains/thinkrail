import type { SpeechModel, SpeechStatus } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Switch } from "@thinkrail/ui/switch";
import { type ReactNode, useRef, useState } from "react";
import {
	SETTINGS_ROWS,
	SettingsChoice,
	SettingsNotice,
	SettingsPage,
	SettingsRow,
} from "@/settingsKit";
import { dictationShortcutLabel, speechErrorKey } from "@/speech";
import { SettingsSection, toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { ConfirmDialog } from "./ConfirmDialog";
import { saveSettings } from "./saveSettings";
import { useConfigReset } from "./settingDefaults";
import { SETTING, settingProps } from "./settingsCatalog";

export const DICTATION_SHORTCUT_TARGET = "shortcut:dictation";

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
	const enabledReset = useConfigReset("voiceInputEnabled", "settings.voice.actionFailed");
	const [removing, setRemoving] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const confirmed = useRef(false);
	const focusCancel = useRef(false);
	const toggleRef = useRef<HTMLButtonElement>(null);
	const deleteRef = useRef<HTMLButtonElement>(null);

	const page = (children: ReactNode) => (
		<SettingsPage
			title={t("settings.nav.voice")}
			description={t("settings.voice.description")}
			testId="settings-voice"
		>
			{children}
		</SettingsPage>
	);

	if (!status) return null;
	if (!status.supported) {
		return page(
			<SettingsNotice variant="warning" testId="settings-voice-unsupported">
				{t("speech.mic.unavailable.unsupportedPlatform")}
			</SettingsNotice>,
		);
	}

	const failed = () => {
		toast.error(t("settings.voice.actionFailed"));
	};
	const installModel = (next: SpeechModel) =>
		getTransport()
			.request("speech.install", { model: next })
			.catch(() => {
				focusCancel.current = false;
				failed();
			});
	const cancelInstall = () => getTransport().request("speech.cancelInstall", {}).catch(failed);
	const remove = () => {
		setRemoving(true);
		void getTransport()
			.request("speech.remove", {})
			.catch(failed)
			.finally(() => setRemoving(false));
	};

	const install = status.install;
	const installing = install.status === "installing";
	const model = selectedModel(status);
	const statusAction = installing ? (
		<Button
			variant="outline"
			size="m"
			tabIndex={0}
			data-testid="settings-voice-cancel"
			ref={(node) => {
				if (!node || !focusCancel.current) return;
				focusCancel.current = false;
				node.focus();
			}}
			onClick={() => void cancelInstall()}
		>
			{t("settings.voice.cancel")}
		</Button>
	) : install.status === "ready" ? null : (
		<Button
			variant="primary"
			size="m"
			tabIndex={0}
			data-testid="settings-voice-install"
			onClick={() =>
				void installModel(install.status === "failed" ? install.model : "multilingual")
			}
		>
			{install.status === "failed" ? t("speech.offer.retry") : t("settings.voice.download")}
		</Button>
	);

	return page(
		<div className={SETTINGS_ROWS}>
			<SettingsRow
				{...settingProps(t, SETTING.voiceInput)}
				description={
					enabled ? t("settings.voice.enableDescription") : t("settings.voice.disabledDescription")
				}
				control={
					<Switch
						ref={toggleRef}
						checked={enabled}
						label={t("settings.voice.enable")}
						testId="settings-voice-toggle"
						tabIndex={0}
						onCheckedChange={(voiceInputEnabled) =>
							void saveSettings({ voiceInputEnabled }, t("settings.voice.actionFailed"))
						}
					/>
				}
				reset={enabledReset}
			/>
			{enabled || installing ? (
				<SettingsRow
					rowId="voice-status"
					label={t("settings.voice.status")}
					description={<StatusText status={status} />}
					testId="settings-voice-status"
					control={statusAction}
				/>
			) : null}
			{enabled ? (
				<SettingsRow
					{...settingProps(t, SETTING.voiceLanguage)}
					testId="settings-voice-language"
					control={
						<SettingsChoice<SpeechModel>
							label={t("settings.voice.language")}
							value={model}
							cost="expensive"
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
								if (next === model) return;
								focusCancel.current = true;
								void installModel(next);
							}}
						/>
					}
				/>
			) : null}
			{enabled ? (
				<SettingsRow
					{...settingProps(t, SETTING.voiceShortcut)}
					testId="settings-voice-shortcut"
					control={
						<div className="flex items-center gap-8">
							<kbd
								data-testid="settings-voice-shortcut-keys"
								className="rounded-xs bg-control-bg px-4 py-2 text-text-default tr-text-metadata"
							>
								{dictationShortcutLabel()}
							</kbd>
							<Button
								variant="outline"
								size="m"
								tabIndex={0}
								data-testid="settings-voice-shortcut-change"
								onClick={() =>
									useAppStore
										.getState()
										.openSettings(SettingsSection.Keyboard, DICTATION_SHORTCUT_TARGET)
								}
							>
								{t("settings.voice.changeShortcut")}
							</Button>
						</div>
					}
				/>
			) : null}
			{status.diskBytes > 0 ? (
				<SettingsRow
					{...settingProps(t, SETTING.voiceFiles)}
					description={t("settings.voice.deleteDescription", {
						size: megabytes(status.diskBytes),
					})}
					testId="settings-voice-files"
					control={
						<Button
							ref={deleteRef}
							variant="outline"
							size="m"
							tone="danger"
							tabIndex={0}
							data-testid="settings-voice-delete"
							disabled={removing}
							onClick={() => setConfirming(true)}
						>
							{t("settings.voice.deleteAction")}
						</Button>
					}
				/>
			) : null}
			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title={t("settings.voice.deleteConfirmTitle")}
				description={t("settings.voice.deleteDescription", { size: megabytes(status.diskBytes) })}
				confirmLabel={t("settings.voice.deleteButton")}
				destructive
				confirmTestId="settings-voice-delete-confirm"
				onConfirm={() => {
					confirmed.current = true;
					remove();
				}}
				onClosedAutoFocus={() => {
					const target = confirmed.current ? toggleRef.current : deleteRef.current;
					confirmed.current = false;
					(target ?? toggleRef.current)?.focus();
				}}
			/>
		</div>,
	);
}
