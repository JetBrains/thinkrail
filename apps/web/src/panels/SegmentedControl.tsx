import { cn } from "@thinkrail/ui/utils";

export interface SegmentedControlOption<T extends string> {
	id: T;
	label: string;
	testId?: string;
}

export interface SegmentedControlProps<T extends string> {
	/** Name for the radio group (accessibility) */
	name: string;
	/** Accessible label for the control group */
	label: string;
	/** Available options */
	options: readonly SegmentedControlOption<T>[];
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
 * A compact segmented control for mutually exclusive options.
 * Use for small sets of 2-4 options (e.g., System/Light/Dark, Soft/Default/High).
 */
export function SegmentedControl<T extends string>({
	name,
	label,
	options,
	value,
	onSelect,
	disabled = false,
	testId,
}: SegmentedControlProps<T>) {
	return (
		<div
			role="radiogroup"
			aria-label={label}
			data-testid={testId}
			className="inline-flex h-32 overflow-hidden rounded-sm bg-control-bg"
		>
			{options.map((option) => {
				const selected = option.id === value;
				return (
					<label
						key={option.id}
						data-testid={option.testId}
						data-active={selected}
						className={cn(
							"relative cursor-pointer transition-colors",
							disabled && "cursor-default",
						)}
					>
						<input
							type="radio"
							name={name}
							value={option.id}
							checked={selected}
							disabled={disabled}
							onChange={() => onSelect(option.id)}
							className="peer sr-only inset-0"
						/>
						<span
							className={cn(
								"flex h-32 items-center px-12 tr-text-ui transition-colors",
								selected
									? "rounded-sm bg-control-bg-selected text-text-default"
									: "text-text-muted hover:text-text-default",
								"peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-primary",
								"peer-disabled:text-control-disabled-text peer-disabled:hover:text-control-disabled-text",
							)}
						>
							{option.label}
						</span>
					</label>
				);
			})}
		</div>
	);
}
