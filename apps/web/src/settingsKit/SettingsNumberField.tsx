import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { useId } from "react";
import { SETTINGS_INPUT, useSettingsDraft } from "./settingsDraft";

export function parseSettingsNumber(draft: string, min: number, max: number): number | null {
	if (!/^\d+$/.test(draft.trim())) return null;
	const value = Number(draft.trim());
	return value >= min && value <= max ? value : null;
}

export interface SettingsNumberFieldProps {
	label: string;
	value: number;
	min: number;
	max: number;
	unit?: string | undefined;
	disabled?: boolean;
	className?: string;
	testId?: string;
	onCommit: (value: number) => undefined | Promise<boolean>;
}

export function SettingsNumberField({
	label,
	value,
	min,
	max,
	unit,
	disabled = false,
	className,
	testId,
	onCommit,
}: SettingsNumberFieldProps) {
	const t = useT();
	const errorId = useId();
	const { invalid, dirty, inputProps } = useSettingsDraft({
		saved: String(value),
		isValid: (draft) => parseSettingsNumber(draft, min, max) !== null,
		commit: (draft) => {
			const parsed = parseSettingsNumber(draft, min, max);
			return parsed === null || parsed === value ? undefined : onCommit(parsed);
		},
	});
	return (
		<span className="flex flex-col items-end gap-2">
			<span className="flex items-center gap-4 text-text-muted tr-text-ui">
				<input
					type="text"
					inputMode="numeric"
					tabIndex={0}
					{...inputProps}
					disabled={disabled}
					aria-label={label}
					aria-describedby={invalid ? errorId : undefined}
					data-setting-clean={dirty ? undefined : ""}
					data-testid={testId}
					className={cn(SETTINGS_INPUT, "w-64 text-right", className)}
				/>
				{unit ? <span>{unit}</span> : null}
			</span>
			{invalid ? (
				<span id={errorId} className="text-feedback-error tr-text-metadata">
					{t("settings.kit.number.range", { min, max })}
				</span>
			) : null}
		</span>
	);
}
