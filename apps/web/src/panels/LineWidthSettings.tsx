import { type AppConfigUpdate, isLineWidth, LINE_WIDTH_COLUMNS } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useState } from "react";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { SETTINGS_ROWS_CONTAINER, SettingsRow } from "./SettingsRow";
import { SettingsSwitch } from "./SettingsSwitch";

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

function updateLineWidth(config: AppConfigUpdate, failure: string): Promise<boolean> {
	return getTransport()
		.request("settings.update", { config })
		.then(
			() => true,
			(err: unknown) => {
				toast.error(errorText(err), failure);
				return false;
			},
		);
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
	const [draft, setDraft] = useState(String(value));
	const [submitted, setSubmitted] = useState<number | null>(null);
	useEffect(() => {
		setDraft(String(value));
		setSubmitted(null);
	}, [value]);
	const parsed = parsedWidth(draft);
	const invalid = parsed === null;
	const errorId = `${kind}-line-width-error`;
	const copy = COPY[kind];

	const commit = () => {
		if (parsed === null || parsed === value || parsed === submitted) return;
		setSubmitted(parsed);
		void updateLineWidth(widthConfig(kind, parsed), t(copy.failure)).then((saved) => {
			if (!saved) setSubmitted(null);
		});
	};

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
						value={draft}
						aria-label={t(copy.inputLabel)}
						aria-invalid={invalid}
						aria-describedby={invalid ? errorId : undefined}
						data-testid={`${kind}-line-width-input`}
						data-settings-draft-input
						onChange={(event) => setDraft(event.currentTarget.value)}
						onBlur={commit}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								commit();
							} else if (event.key === "Escape") {
								setDraft(String(value));
							}
						}}
						className="h-32 w-80 rounded-sm border border-control-border-default bg-control-bg px-8 tr-text-ui text-text-default outline-none focus:border-control-border-active focus-visible:ring-2 focus-visible:ring-primary aria-invalid:border-feedback-error"
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
							void updateLineWidth(boundedConfig(kind, next), t(copy.failure));
						}}
					/>
				}
			/>
		</div>
	);
}
