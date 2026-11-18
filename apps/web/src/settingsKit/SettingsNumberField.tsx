import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { useId } from "react";
import { SETTINGS_INPUT, useSettingsDraft } from "./settingsDraft";

export function parseSettingsNumber(draft: string, min: number, max: number): number | null {
	if (!/^\d+$/.test(draft.trim())) return null;
	const value = Number(draft.trim());
	return value >= min && value <= max ? value : null;
}

type Commit = undefined | Promise<boolean>;

export interface SettingsNumberFieldProps {
	label: string;
	value: number | null;
	min: number;
	max: number;
	unit?: string | undefined;
	placeholder?: string | undefined;
	disabled?: boolean;
	className?: string;
	testId?: string;
	onCommit: (value: number) => Commit;
	onClear?: (() => Commit) | undefined;
}

export function SettingsNumberField({
	label,
	value,
	min,
	max,
	unit,
	placeholder,
	disabled = false,
	className,
	testId,
	onCommit,
	onClear,
}: SettingsNumberFieldProps) {
	const t = useT();
	const errorId = useId();
	const empty = (draft: string) => onClear !== undefined && draft.trim() === "";
	const { invalid, dirty, inputProps } = useSettingsDraft({
		saved: value === null ? "" : String(value),
		isValid: (draft) => empty(draft) || parseSettingsNumber(draft, min, max) !== null,
		commit: (draft) => {
			if (empty(draft)) return value === null ? undefined : onClear?.();
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
					placeholder={placeholder}
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
