import type { ProxyConfig, ProxyMode } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { SettingsGroup, SettingsPageContainer } from "./SettingsGroup";
import { SettingsRadioCards, type SettingsRadioChoice } from "./SettingsRadioCards";
import { SettingsRow } from "./SettingsRow";

export interface ManualProxy {
	host: string;
	port: string;
}

function splitManual(target: string | undefined): ManualProxy {
	const match = target ? /^([^:]+):(\d+)$/.exec(target.trim()) : null;
	const [, host = "", port = ""] = match ?? [];
	return { host, port };
}

const INPUT_CLASS =
	"h-32 rounded-sm border border-control-border-default bg-control-bg px-8 tr-text-ui text-text-default placeholder:text-text-muted outline-none transition-colors focus:border-control-border-active";

export function ProxyPage({
	mode,
	manual,
	onSelectMode,
	onManualDraft,
	onManualCommit,
}: {
	mode: ProxyMode;
	manual: ManualProxy;
	onSelectMode: (mode: ProxyMode) => void;
	onManualDraft: (manual: ManualProxy) => void;
	onManualCommit: () => void;
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
										onManualDraft({ host: event.currentTarget.value, port: manual.port })
									}
									onBlur={onManualCommit}
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
										onManualDraft({ host: manual.host, port: event.currentTarget.value })
									}
									onBlur={onManualCommit}
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
	const t = useT();
	const stored = useAppStore((s) => s.proxy);
	const mode: ProxyMode = stored?.mode ?? "system";
	const [manual, setManual] = useState<ManualProxy>(() => splitManual(stored?.manualTarget));

	const commit = (next: ProxyConfig | null) => {
		getTransport()
			.request("settings.update", { config: { proxy: next } })
			.catch((error) => toast.error(errorText(error, t("settings.proxy.changeFailed"))));
	};

	const selectMode = (next: ProxyMode) => {
		if (next !== "manual") {
			commit({ mode: next });
			return;
		}
		const host = manual.host.trim();
		const port = manual.port.trim();
		commit(host && port ? { mode: "manual", manualTarget: `${host}:${port}` } : { mode: "manual" });
	};

	const commitManual = () => {
		const host = manual.host.trim();
		const port = manual.port.trim();
		if (host && port) commit({ mode: "manual", manualTarget: `${host}:${port}` });
	};

	return (
		<ProxyPage
			mode={mode}
			manual={manual}
			onSelectMode={selectMode}
			onManualDraft={setManual}
			onManualCommit={commitManual}
		/>
	);
}
