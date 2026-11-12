import { type AppConfigUpdate, isLineWidth, LINE_WIDTH_COLUMNS } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { useAppStore } from "@/store";
import { SETTINGS_ROWS_CONTAINER, SettingsRow } from "./SettingsRow";
import { SettingsSwitch } from "./SettingsSwitch";
import { saveSettings } from "./saveSettings";
import { SETTINGS_INPUT, useSettingsDraft } from "./settingsDraft";

type LineWidthKind = "chat" | "file";

const COPY = {
	chat: {
		description: "settings.lineWidth.chat.description",
		failure: "settings.lineWidth.chat.failure",
		inputLabel: "settings.lineWidth.chat.inputLabel",
		boundedLabel: "settings.lineWidth.chat.boundedLabel",
	},
	file: {
		description: "settings.lineWidth.file.description",
		failure: "settings.lineWidth.file.failure",
		inputLabel: "settings.lineWidth.file.inputLabel",
		boundedLabel: "settings.lineWidth.file.boundedLabel",
	},
} satisfies Record<
	LineWidthKind,
	{ description: MessageKey; failure: MessageKey; inputLabel: MessageKey; boundedLabel: MessageKey }
>;

function parsedWidth(draft: string): number | null {
	if (!/^\d+$/.test(draft)) return null;
	const value = Number(draft);
	return isLineWidth(value) ? value : null;
}

function widthConfig(kind: LineWidthKind, value: number): AppConfigUpdate {
	return kind === "chat" ? { chatLineWidth: value } : { fileLineWidth: value };
}

function boundedConfig(kind: LineWidthKind, bounded: boolean): AppConfigUpdate {
	return kind === "chat" ? { chatLineWidthBounded: bounded } : { fileLineWidthBounded: bounded };
}

export function LineWidthControl({ kind }: { kind: LineWidthKind }) {
	const t = useT();
	const value = useAppStore((state) =>
		kind === "chat" ? state.chatLineWidth : state.fileLineWidth,
	);
	const bounded = useAppStore((state) =>
		kind === "chat" ? state.chatLineWidthBounded : state.fileLineWidthBounded,
	);
	const copy = COPY[kind];
	const { invalid, inputProps } = useSettingsDraft({
		saved: String(value),
		isValid: (draft) => parsedWidth(draft) !== null,
		commit: (draft) => {
			const parsed = parsedWidth(draft);
			if (parsed === null || parsed === value) return undefined;
			return saveSettings(widthConfig(kind, parsed), t(copy.failure));
		},
	});
	const errorId = `${kind}-line-width-error`;

	return (
		<div
			data-testid={`${kind}-line-width-control`}
			className={cn(SETTINGS_ROWS_CONTAINER, "border-border-muted border-b")}
		>
			<SettingsRow
				label={t("settings.lineWidth.label")}
				description={
					<>
						{t(copy.description)}
						{invalid ? (
							<span
								id={errorId}
								data-testid={errorId}
								className="block text-feedback-error tr-text-metadata"
							>
								{t("settings.lineWidth.invalid", {
									min: LINE_WIDTH_COLUMNS.min,
									max: LINE_WIDTH_COLUMNS.max,
								})}
							</span>
						) : null}
					</>
				}
				control={
					<input
						type="number"
						min={LINE_WIDTH_COLUMNS.min}
						max={LINE_WIDTH_COLUMNS.max}
						step={1}
						inputMode="numeric"
						{...inputProps}
						aria-label={t(copy.inputLabel)}
						aria-describedby={invalid ? errorId : undefined}
						data-testid={`${kind}-line-width-input`}
						className={cn(SETTINGS_INPUT, "w-80")}
					/>
				}
			/>
			<SettingsRow
				label={t("settings.lineWidth.fitToPane")}
				description={t("settings.lineWidth.fitToPaneDescription")}
				control={
					<SettingsSwitch
						checked={bounded}
						label={t(copy.boundedLabel)}
						testId={`${kind}-line-width-bounded`}
						onChange={(next) => {
							void saveSettings(boundedConfig(kind, next), t(copy.failure));
						}}
					/>
				}
			/>
		</div>
	);
}
