import { RiCheckLine as Check } from "@remixicon/react";
import { cn } from "@thinkrail/ui/utils";

export interface SettingsRadioChoice<T extends string> {
	id: T;
	label: string;
	hint?: string;
	description: string;
	testId: string;
	disabled?: boolean;
}

export function SettingsRadioCards<T extends string>({
	name,
	label,
	choices,
	value,
	disabled = false,
	onSelect,
}: {
	name: string;
	label: string;
	choices: readonly SettingsRadioChoice<T>[];
	value: T;
	disabled?: boolean;
	onSelect: (value: T) => void;
}) {
	return (
		<div role="radiogroup" aria-label={label} className="flex flex-col gap-4">
			{choices.map((choice) => {
				const active = choice.id === value;
				const choiceDisabled = disabled || choice.disabled === true;
				return (
					<label
						key={choice.id}
						data-testid={choice.testId}
						data-active={active}
						className={cn(
							"flex items-center gap-8 rounded-sm border px-12 py-8 text-left transition-colors has-[:focus-visible]:focus-ring",
							choiceDisabled ? "cursor-default" : "cursor-pointer",
							choiceDisabled
								? "border-control-disabled-border bg-control-disabled-bg"
								: active
									? "border-primary-muted bg-clip-padding bg-primary-subtle"
									: "border-border-default hover:bg-control-bg-hovered",
						)}
					>
						<input
							type="radio"
							name={name}
							value={choice.id}
							checked={active}
							disabled={choiceDisabled}
							onChange={() => onSelect(choice.id)}
							className="sr-only"
						/>
						<span className="min-w-0 flex-1">
							<span
								className={cn(
									"flex items-center gap-4 tr-title-compact",
									choiceDisabled ? "text-text-disabled" : "text-text-default",
								)}
							>
								{choice.label}
								{choice.hint ? (
									<span
										className={cn(
											"tr-text-metadata",
											choiceDisabled ? "text-text-disabled" : "text-text-muted",
										)}
									>
										{choice.hint}
									</span>
								) : null}
							</span>
							<span
								className={cn(
									"block tr-text-metadata",
									choiceDisabled ? "text-text-disabled" : "text-text-muted",
								)}
							>
								{choice.description}
							</span>
						</span>
						{active ? (
							<Check
								className={cn(
									"size-16 shrink-0",
									choiceDisabled ? "text-control-disabled-text" : "text-primary",
								)}
							/>
						) : null}
					</label>
				);
			})}
		</div>
	);
}
