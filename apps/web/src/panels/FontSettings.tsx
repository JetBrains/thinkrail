import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
	FONT_KINDS,
	FONT_NAME_MAX_LENGTH,
	type FontKind,
	getFontPreferences,
	normalizeFontName,
	subscribeFontPreferences,
	updateFontPreference,
} from "@/fonts";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsNotice } from "./SettingsNotice";
import { SettingsRow } from "./SettingsRow";

const COPY = {
	interface: {
		label: "settings.fonts.interface.label",
		description: "settings.fonts.interface.description",
		preview: "settings.fonts.interface.preview",
		className: "tr-text-ui",
	},
	code: {
		label: "settings.fonts.code.label",
		description: "settings.fonts.code.description",
		preview: "settings.fonts.code.preview",
		className: "tr-code-text",
	},
	terminal: {
		label: "settings.fonts.terminal.label",
		description: "settings.fonts.terminal.description",
		preview: "settings.fonts.terminal.preview",
		className: "tr-code-terminal",
	},
} satisfies Record<
	FontKind,
	{ label: MessageKey; description: MessageKey; preview: MessageKey; className: string }
>;

function FontControl({
	kind,
	value,
	onPersistence,
}: {
	kind: FontKind;
	value: string;
	onPersistence: (saved: boolean) => void;
}) {
	const t = useT();
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	const invalid = normalizeFontName(draft) === null;
	const errorId = `font-${kind}-error`;
	const copy = COPY[kind];
	const commit = (next: string) => {
		const result = updateFontPreference(kind, next);
		if (result === "invalid") return;
		setDraft(next.trim());
		onPersistence(result === "saved");
	};
	return (
		<SettingsRow
			label={t(copy.label)}
			description={
				<>
					{t(copy.description)}
					{invalid ? (
						<span id={errorId} role="alert" className="block tr-text-metadata text-feedback-error">
							{t("settings.fonts.invalid", { max: FONT_NAME_MAX_LENGTH })}
						</span>
					) : null}
				</>
			}
			control={
				<div className="flex flex-wrap items-center gap-8">
					<input
						type="text"
						value={draft}
						aria-label={t(copy.label)}
						aria-invalid={invalid}
						aria-describedby={invalid ? errorId : undefined}
						placeholder={t("common.default")}
						data-testid={`font-${kind}-input`}
						data-settings-draft-input
						spellCheck={false}
						onChange={(event) => setDraft(event.currentTarget.value)}
						onBlur={() => commit(draft)}
						onKeyDown={(event) => {
							if (event.nativeEvent.isComposing) return;
							if (event.key === "Enter") {
								event.preventDefault();
								commit(draft);
							} else if (event.key === "Escape") {
								event.stopPropagation();
								setDraft(value);
							}
						}}
						className="h-32 w-200 max-w-full rounded-sm border border-control-border-default bg-control-bg px-8 tr-text-ui text-text-default outline-none focus:border-control-border-active focus-visible:ring-2 focus-visible:ring-primary aria-invalid:border-feedback-error"
					/>
					<Button
						variant="ghost"
						size="sm"
						aria-label={t("settings.fonts.resetLabel", { font: t(copy.label) })}
						data-testid={`font-${kind}-reset`}
						disabled={!value && !draft}
						onClick={() => commit("")}
					>
						{t("settings.fonts.reset")}
					</Button>
				</div>
			}
		/>
	);
}

export function FontSettings() {
	const t = useT();
	const preferences = useSyncExternalStore(
		subscribeFontPreferences,
		getFontPreferences,
		getFontPreferences,
	);
	const [saved, setSaved] = useState(true);
	return (
		<SettingsGroup
			title={t("settings.fonts.title")}
			description={t("settings.fonts.description")}
			testId="font-settings"
		>
			{FONT_KINDS.map((kind) => (
				<FontControl key={kind} kind={kind} value={preferences[kind]} onPersistence={setSaved} />
			))}
			{!saved ? (
				<SettingsNotice variant="warning" testId="font-storage-warning">
					{t("settings.fonts.storageFailed")}
				</SettingsNotice>
			) : null}
			<section
				className="mt-12 flex flex-col gap-8 overflow-hidden rounded-sm bg-container-content-bg p-12 text-text-default"
				aria-label={t("settings.fonts.previewLabel")}
			>
				{FONT_KINDS.map((kind) => (
					<p
						key={kind}
						data-testid={`font-${kind}-preview`}
						className={`${COPY[kind].className} break-words`}
					>
						{t(COPY[kind].preview)}
					</p>
				))}
			</section>
		</SettingsGroup>
	);
}
