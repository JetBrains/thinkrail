import { type AppConfigUpdate, LINE_WIDTH_COLUMNS, type LineWidthKind } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Switch } from "@thinkrail/ui/switch";
import { useId } from "react";
import { SETTINGS_ROWS, SettingsGroup, SettingsNumberField, SettingsRow } from "@/settingsKit";
import { useAppStore } from "@/store";
import { saveSettings } from "./saveSettings";
import { configResetPatch, isConfigDefault } from "./settingDefaults";
import { SETTING, settingProps } from "./settingsCatalog";

const COPY = {
	chat: {
		title: "settings.lineWidth.chat.title",
		summary: "settings.lineWidth.chat.summary",
		failure: "settings.lineWidth.chat.failure",
		inputLabel: "settings.lineWidth.chat.inputLabel",
		boundedLabel: "settings.lineWidth.chat.boundedLabel",
	},
	file: {
		title: "settings.lineWidth.file.title",
		summary: "settings.lineWidth.file.summary",
		failure: "settings.lineWidth.file.failure",
		inputLabel: "settings.lineWidth.file.inputLabel",
		boundedLabel: "settings.lineWidth.file.boundedLabel",
	},
} as const satisfies Record<LineWidthKind, Record<string, MessageKey>>;

const KEYS = {
	chat: { width: "chatLineWidth", bounded: "chatLineWidthBounded" },
	file: { width: "fileLineWidth", bounded: "fileLineWidthBounded" },
} as const;

function widthConfig(kind: LineWidthKind, value: number): AppConfigUpdate {
	return kind === "chat" ? { chatLineWidth: value } : { fileLineWidth: value };
}

function boundedConfig(kind: LineWidthKind, bounded: boolean): AppConfigUpdate {
	return kind === "chat" ? { chatLineWidthBounded: bounded } : { fileLineWidthBounded: bounded };
}

const ENTRIES = {
	chat: { width: SETTING.chatLineWidth, bounded: SETTING.chatFitToPane },
	file: { width: SETTING.fileLineWidth, bounded: SETTING.fileFitToPane },
} as const;

export interface LineWidthCardProps {
	kind: LineWidthKind;
	value: number;
	bounded: boolean;
	onSave: (config: AppConfigUpdate) => Promise<boolean>;
}

export function LineWidthCard({ kind, value, bounded, onSave }: LineWidthCardProps) {
	const t = useT();
	const headingId = useId();
	const copy = COPY[kind];
	const keys = KEYS[kind];
	const entries = ENTRIES[kind];
	return (
		<section
			aria-labelledby={headingId}
			data-testid={`${kind}-line-width-control`}
			className="flex min-w-0 flex-col rounded-md border border-border-default bg-clip-padding px-12"
		>
			<div className="flex flex-col gap-2 pt-12 pb-4">
				<h4 id={headingId} className="tr-title-compact text-text-default">
					{t(copy.title)}
				</h4>
				<p className="tr-text-metadata text-text-muted">{t(copy.summary)}</p>
			</div>
			<div className={SETTINGS_ROWS}>
				<SettingsRow
					{...settingProps(t, entries.width)}
					label={t("settings.lineWidth.label")}
					control={
						<SettingsNumberField
							label={t(copy.inputLabel)}
							value={value}
							min={LINE_WIDTH_COLUMNS.min}
							max={LINE_WIDTH_COLUMNS.max}
							unit={t("settings.lineWidth.unit")}
							testId={`${kind}-line-width-input`}
							onCommit={(width) => onSave(widthConfig(kind, width))}
						/>
					}
					reset={{
						changed: !isConfigDefault(keys.width, value),
						onReset: () => void onSave(configResetPatch(keys.width)),
					}}
				/>
				<SettingsRow
					{...settingProps(t, entries.bounded)}
					label={t("settings.lineWidth.fitToPane")}
					control={
						<Switch
							checked={bounded}
							label={t(copy.boundedLabel)}
							testId={`${kind}-line-width-bounded`}
							tabIndex={0}
							onCheckedChange={(next) => void onSave(boundedConfig(kind, next))}
						/>
					}
					reset={{
						changed: !isConfigDefault(keys.bounded, bounded),
						onReset: () => void onSave(configResetPatch(keys.bounded)),
					}}
				/>
			</div>
		</section>
	);
}

export function LineWidthControl({ kind }: { kind: LineWidthKind }) {
	const t = useT();
	const value = useAppStore((state) =>
		kind === "chat" ? state.chatLineWidth : state.fileLineWidth,
	);
	const bounded = useAppStore((state) =>
		kind === "chat" ? state.chatLineWidthBounded : state.fileLineWidthBounded,
	);
	return (
		<LineWidthCard
			kind={kind}
			value={value}
			bounded={bounded}
			onSave={(config) => saveSettings(config, t(COPY[kind].failure))}
		/>
	);
}

export function LineWidthGroup() {
	const t = useT();
	return (
		<SettingsGroup
			title={t("settings.lineWidth.label")}
			description={t("settings.lineWidth.groupDescription")}
		>
			<div className="@container py-12">
				<div className="grid grid-cols-1 gap-12 @md:grid-cols-2">
					<LineWidthControl kind="chat" />
					<LineWidthControl kind="file" />
				</div>
			</div>
		</SettingsGroup>
	);
}
