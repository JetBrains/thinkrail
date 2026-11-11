import {
	CACHE_WARMING_MODES,
	CACHE_WARMING_SETTINGS_PROTOCOL_VERSION,
	type CacheWarmingMode,
	type CacheWarmingSetting,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { t as translate, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsRadioCards, type SettingsRadioChoice } from "./SettingsRadioCards";

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
	pending,
	failed,
	onSelect,
	onRetry,
}: {
	protocolVersion: number | null;
	setting: CacheWarmingSetting | null;
	pending: boolean;
	failed: boolean;
	onSelect: (mode: CacheWarmingMode) => void;
	onRetry: () => void;
}) {
	const t = useT();
	if (!supported(protocolVersion)) return null;
	const choices: SettingsRadioChoice<CacheWarmingMode>[] = CACHE_WARMING_MODES.map((mode) => ({
		id: mode,
		label: t(MODE_LABEL[mode]),
		description: t(MODE_DESCRIPTION[mode]),
		testId: `cache-warming-${mode}`,
		...(mode === "streaming" && setting?.source === "default"
			? { hint: t("settings.cacheWarming.defaultHint") }
			: {}),
	}));
	return (
		<SettingsGroup
			title={t("settings.cacheWarming.title")}
			description={t("settings.cacheWarming.description")}
			testId="cache-warming-group"
		>
			{failed && setting === null ? (
				<div className="flex items-center justify-between gap-12">
					<p className="tr-text-metadata text-text-muted">
						{t("settings.cacheWarming.loadFailed")}
					</p>
					<Button variant="ghost" size="m" onClick={onRetry} data-testid="cache-warming-retry">
						{t("common.retry")}
					</Button>
				</div>
			) : (
				<div data-testid="cache-warming" data-cache-warming-source={setting?.source ?? "loading"}>
					<SettingsRadioCards
						name="cache-warming"
						label={t("settings.cacheWarming.title")}
						choices={choices}
						value={setting?.mode ?? "streaming"}
						disabled={pending || setting === null}
						onSelect={onSelect}
					/>
				</div>
			)}
		</SettingsGroup>
	);
}

export function CacheWarmingSettings() {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const [setting, setSetting] = useState<CacheWarmingSetting | null>(null);
	const [pending, setPending] = useState(true);
	const [failed, setFailed] = useState(false);
	const sequence = useRef(0);

	const synchronize = useCallback(
		async (mode?: CacheWarmingMode) => {
			if (!supported(protocolVersion)) return;
			const current = ++sequence.current;
			setPending(true);
			const request =
				mode === undefined
					? () => getTransport().request("cacheWarming.get", {})
					: () => getTransport().request("cacheWarming.set", { mode });
			let next: CacheWarmingSetting | undefined;
			try {
				next = await request();
			} catch {}
			if (next === undefined && mode !== undefined)
				toast.error(translate("settings.cacheWarming.updateFailed"));
			if (current !== sequence.current) return;
			if (next === undefined) setFailed(true);
			else {
				setSetting(next);
				setFailed(false);
			}
			setPending(false);
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
			pending={pending}
			failed={failed}
			onRetry={() => void synchronize()}
			onSelect={(mode) => {
				if (pending || mode === setting?.mode) return;
				void synchronize(mode);
			}}
		/>
	);
}
