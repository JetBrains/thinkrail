import { RiCheckLine as Check } from "@remixicon/react";
import { cn } from "@/lib";

export interface SettingsRadioChoice<T extends string> {
	id: T;
	label: string;
	hint?: string;
	description: string;
	testId: string;
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
				return (
					<label
						key={choice.id}
						data-testid={choice.testId}
						data-active={active}
						className={cn(
							"flex items-center gap-8 rounded-[var(--radius-sm)] border px-12 py-8 text-left transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
							disabled ? "cursor-default" : "cursor-pointer",
							active
								? "border-primary-muted bg-clip-padding bg-primary-subtle"
								: "border-border-default hover:bg-control-bg-hovered",
						)}
					>
						<input
							type="radio"
							name={name}
							value={choice.id}
							checked={active}
							disabled={disabled}
							onChange={() => onSelect(choice.id)}
							className="sr-only"
						/>
						<span className="min-w-0 flex-1">
							<span className="flex items-center gap-4 tr-title-compact text-text-default">
								{choice.label}
								{choice.hint ? (
									<span className="text-text-muted tr-text-metadata">{choice.hint}</span>
								) : null}
							</span>
							<span className="block text-text-muted tr-text-metadata">{choice.description}</span>
						</span>
						{active ? <Check className="size-16 shrink-0 text-primary" /> : null}
					</label>
				);
			})}
		</div>
	);
}
