import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import {
	firstPaintPreferenceStorage,
	getStablePreferenceAdapter,
	type StablePreferenceAdapter,
} from "../clientPreferences";
import { SettingsGroup, SettingsPageContainer } from "./SettingsGroup";
import { SettingsRadioCards, type SettingsRadioChoice } from "./SettingsRadioCards";
import { SettingsRow } from "./SettingsRow";

const PROXY_MODE_KEY = "proxy.mode";
const PROXY_MANUAL_KEY = "proxy.manual";

export type ProxyMode = "system" | "manual" | "none";

export interface ManualProxy {
	host: string;
	port: string;
}

function readMode(storage: StablePreferenceAdapter): ProxyMode {
	const raw = storage.getItem(PROXY_MODE_KEY);
	return raw === "manual" || raw === "none" ? raw : "system";
}

function readManual(storage: StablePreferenceAdapter): ManualProxy {
	const raw = storage.getItem(PROXY_MANUAL_KEY) ?? "";
	const match = /^([^:]+):(\d+)$/.exec(raw.trim());
	const [, host = "", port = ""] = match ?? [];
	return { host, port };
}

const INPUT_CLASS =
	"h-32 rounded-sm border border-control-border-default bg-control-bg px-8 tr-text-ui text-text-default placeholder:text-text-muted outline-none transition-colors focus:border-control-border-active";

export function ProxyPage({
	mode,
	manual,
	onSelectMode,
	onManualChange,
}: {
	mode: ProxyMode;
	manual: ManualProxy;
	onSelectMode: (mode: ProxyMode) => void;
	onManualChange: (manual: ManualProxy) => void;
}) {
	const t = useT();

	const choices: SettingsRadioChoice<ProxyMode>[] = [
		{
			id: "system",
			label: t("settings.proxy.mode.system"),
			description: t("settings.proxy.mode.systemDescription"),
			testId: "proxy-system",
		},
		{
			id: "manual",
			label: t("settings.proxy.mode.manual"),
			description: t("settings.proxy.mode.manualDescription"),
			testId: "proxy-manual",
		},
		{
			id: "none",
			label: t("settings.proxy.mode.none"),
			description: t("settings.proxy.mode.noneDescription"),
			testId: "proxy-none",
		},
	];

	return (
		<SettingsPageContainer testId="settings-proxy">
			<SettingsGroup
				title={t("settings.proxy.title")}
				description={t("settings.proxy.description")}
			>
				<div className="py-12">
					<SettingsRadioCards
						name="proxy-mode"
						label={t("settings.proxy.title")}
						choices={choices}
						value={mode}
						onSelect={onSelectMode}
					/>
				</div>
				{mode === "manual" ? (
					<SettingsRow
						label={t("settings.proxy.manualTarget")}
						description={t("settings.proxy.manualTargetDescription")}
						testId="proxy-manual-row"
						control={
							<div className="flex items-center gap-8">
								<input
									type="text"
									value={manual.host}
									placeholder={t("settings.proxy.hostPlaceholder")}
									aria-label={t("settings.proxy.host")}
									data-testid="proxy-host-input"
									onChange={(event) =>
										onManualChange({ host: event.currentTarget.value, port: manual.port })
									}
									className={`${INPUT_CLASS} w-160`}
								/>
								<input
									type="text"
									inputMode="numeric"
									value={manual.port}
									placeholder={t("settings.proxy.portPlaceholder")}
									aria-label={t("settings.proxy.port")}
									data-testid="proxy-port-input"
									onChange={(event) =>
										onManualChange({ host: manual.host, port: event.currentTarget.value })
									}
									className={`${INPUT_CLASS} w-80`}
								/>
							</div>
						}
					/>
				) : null}
			</SettingsGroup>
		</SettingsPageContainer>
	);
}

export function ProxySettings() {
	const storage = getStablePreferenceAdapter() ?? firstPaintPreferenceStorage();
	const [mode, setMode] = useState<ProxyMode>(() => (storage ? readMode(storage) : "system"));
	const [manual, setManual] = useState<ManualProxy>(() =>
		storage ? readManual(storage) : { host: "", port: "" },
	);

	const select = (next: ProxyMode) => {
		setMode(next);
		if (!storage) return;
		if (next === "system") storage.removeItem(PROXY_MODE_KEY);
		else storage.setItem(PROXY_MODE_KEY, next);
	};

	const updateManual = (next: ManualProxy) => {
		setManual(next);
		if (!storage) return;
		const host = next.host.trim();
		const port = next.port.trim();
		if (host && port) storage.setItem(PROXY_MANUAL_KEY, `${host}:${port}`);
		else storage.removeItem(PROXY_MANUAL_KEY);
	};

	return (
		<ProxyPage mode={mode} manual={manual} onSelectMode={select} onManualChange={updateManual} />
	);
}
