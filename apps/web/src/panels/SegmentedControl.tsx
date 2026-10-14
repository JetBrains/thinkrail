import { cn } from "@thinkrail/ui/utils";

export interface SegmentedControlOption<T extends string> {
	id: T;
	label: string;
	testId?: string;
	disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
	name: string;
	label: string;
	options: readonly SegmentedControlOption<T>[];
	value: T | null;
	onSelect: (value: T) => void;
	disabled?: boolean;
	testId?: string;
}

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
				const selected = value !== null && option.id === value;
				const optionDisabled = disabled || option.disabled === true;
				return (
					<label
						key={option.id}
						data-testid={option.testId}
						data-active={selected}
						className={cn(
							"relative cursor-pointer transition-colors",
							optionDisabled && "cursor-default",
						)}
					>
						<input
							type="radio"
							name={name}
							value={option.id}
							checked={selected}
							disabled={optionDisabled}
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
