import {
	CACHE_WARMING_MODES,
	CACHE_WARMING_SETTINGS_PROTOCOL_VERSION,
	type CacheWarmingMode,
	type CacheWarmingSetting,
	DEFAULT_CACHE_WARMING_MODE,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { t as translate, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useCallback, useEffect, useRef, useState } from "react";
import { SettingsChoice, SettingsGroup, SettingsRow } from "@/settingsKit";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { SETTING, settingProps } from "./settingsCatalog";

const MODE_LABEL: Record<CacheWarmingMode, MessageKey> = {
	off: "settings.cacheWarming.mode.off",
	streaming: "settings.cacheWarming.mode.streaming",
	idle: "settings.cacheWarming.mode.idle",
};

const MODE_DESCRIPTION: Record<CacheWarmingMode, MessageKey> = {
	off: "settings.cacheWarming.mode.off.description",
	streaming: "settings.cacheWarming.mode.streaming.description",
	idle: "settings.cacheWarming.mode.idle.description",
};

function supported(protocolVersion: number | null): boolean {
	return protocolVersion !== null && protocolVersion >= CACHE_WARMING_SETTINGS_PROTOCOL_VERSION;
}

export function CacheWarmingControls({
	protocolVersion,
	setting,
	failed,
	onSelect,
	onRetry,
}: {
	protocolVersion: number | null;
	setting: CacheWarmingSetting | null;
	failed: boolean;
	onSelect: (mode: CacheWarmingMode) => void;
	onRetry: () => void;
}) {
	const t = useT();
	if (!supported(protocolVersion)) return null;
	const mode = setting?.mode ?? DEFAULT_CACHE_WARMING_MODE;
	const row = settingProps(t, SETTING.promptCache);
	return (
		<SettingsGroup
			title={t("settings.cacheWarming.title")}
			description={t("settings.cacheWarming.description")}
			testId="cache-warming-group"
		>
			{failed && setting === null ? (
				<SettingsRow
					{...row}
					description={t("settings.cacheWarming.loadFailed")}
					control={
						<Button
							variant="outline"
							size="m"
							tabIndex={0}
							data-testid="cache-warming-retry"
							onClick={onRetry}
						>
							{t("common.retry")}
						</Button>
					}
				/>
			) : (
				<SettingsRow
					{...row}
					description={
						<span className="flex flex-wrap gap-x-4">
							<span>{t(MODE_DESCRIPTION[mode])}</span>
							{setting?.source === "default" ? (
								<span className="text-text-subtle">{t("settings.cacheWarming.defaultHint")}</span>
							) : null}
						</span>
					}
					control={
						<span
							data-testid="cache-warming"
							data-cache-warming-source={setting?.source ?? "loading"}
						>
							<SettingsChoice
								label={row.label}
								options={CACHE_WARMING_MODES.map((id) => ({
									id,
									label: t(MODE_LABEL[id]),
									testId: `cache-warming-${id}`,
								}))}
								value={setting ? mode : null}
								cost="cheap"
								disabled={setting === null}
								onSelect={onSelect}
							/>
						</span>
					}
					reset={
						setting
							? {
									changed: setting.mode !== DEFAULT_CACHE_WARMING_MODE,
									onReset: () => onSelect(DEFAULT_CACHE_WARMING_MODE),
								}
							: undefined
					}
				/>
			)}
		</SettingsGroup>
	);
}

export function CacheWarmingSettings() {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const [setting, setSetting] = useState<CacheWarmingSetting | null>(null);
	const [failed, setFailed] = useState(false);
	const sequence = useRef(0);

	const synchronize = useCallback(
		async (mode?: CacheWarmingMode) => {
			if (!supported(protocolVersion)) return;
			const current = ++sequence.current;
			if (mode !== undefined) setSetting({ mode, source: "user" });
			const read = () =>
				getTransport()
					.request("cacheWarming.get", {})
					.catch(() => undefined);
			let next =
				mode === undefined
					? await read()
					: await getTransport()
							.request("cacheWarming.set", { mode })
							.catch(() => undefined);
			if (next === undefined && mode !== undefined) {
				toast.error(translate("settings.cacheWarming.updateFailed"));
				next = await read();
			}
			if (current !== sequence.current) return;
			if (next === undefined) setFailed(true);
			else {
				setSetting(next);
				setFailed(false);
			}
		},
		[protocolVersion],
	);

	useEffect(() => {
		void synchronize();
		return () => {
			sequence.current++;
		};
	}, [synchronize]);

	return (
		<CacheWarmingControls
			protocolVersion={protocolVersion}
			setting={setting}
			failed={failed}
			onRetry={() => void synchronize()}
			onSelect={(mode) => {
				if (setting === null || mode === setting.mode) return;
				void synchronize(mode);
			}}
		/>
	);
}
