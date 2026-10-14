import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";

export interface SettingsRadioOption<T extends string> {
	id: T;
	label: string;
	/** Secondary description shown below the label */
	description?: string;
	/** Additional hint shown next to label (e.g. "Currently On") */
	hint?: ReactNode;
	testId?: string;
}

export interface SettingsRadioGroupProps<T extends string> {
	/** Name for the radio group (accessibility) */
	name: string;
	/** Accessible label for the control group */
	label: string;
	/** Available options */
	options: readonly SettingsRadioOption<T>[];
	/** Currently selected value */
	value: T;
	/** Called when selection changes */
	onSelect: (value: T) => void;
	/** Whether the control is disabled */
	disabled?: boolean;
	/** Test ID for the control */
	testId?: string;
}

/**
 * A compact radio group for Settings.
 * Options are stacked vertically with 12px spacing, no borders or cards.
 * Each option has a radio button, label, optional hint, and optional description.
 */
export function SettingsRadioGroup<T extends string>({
	name,
	label,
	options,
	value,
	onSelect,
	disabled = false,
	testId,
}: SettingsRadioGroupProps<T>) {
	return (
		<div role="radiogroup" aria-label={label} data-testid={testId} className="flex flex-col gap-12">
			{options.map((option) => {
				const selected = option.id === value;
				return (
					<label
						key={option.id}
						data-testid={option.testId}
						data-active={selected}
						className={cn(
							"flex cursor-pointer items-start gap-8",
							disabled && "cursor-default opacity-60",
						)}
					>
						<span className="flex min-w-0 flex-1 flex-col gap-2">
							<span className="flex items-center gap-8">
								<span className="tr-text-ui text-text-default">{option.label}</span>
								{option.hint && (
									<span className="tr-text-metadata text-text-muted">{option.hint}</span>
								)}
							</span>
							{option.description && (
								<span className="tr-text-metadata text-text-muted">{option.description}</span>
							)}
						</span>
						<input
							type="radio"
							name={name}
							value={option.id}
							checked={selected}
							disabled={disabled}
							onChange={() => onSelect(option.id)}
							className="mt-4 size-14 shrink-0 cursor-pointer accent-primary disabled:cursor-default"
						/>
					</label>
				);
			})}
		</div>
	);
}
