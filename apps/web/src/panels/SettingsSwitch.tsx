import { cn } from "@/lib";

export function SettingsSwitch({
	checked,
	label,
	testId,
	onChange,
}: {
	checked: boolean;
	label: string;
	testId: string;
	onChange: (checked: boolean) => void;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			data-testid={testId}
			data-active={checked}
			onClick={() => onChange(!checked)}
			className={cn(
				"relative h-20 w-36 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
				checked ? "bg-primary" : "bg-border-default",
			)}
		>
			<span
				className={cn(
					"absolute top-2 left-2 size-16 rounded-full bg-container-workspace-bg transition-transform",
					checked && "translate-x-16",
				)}
			/>
		</button>
	);
}
