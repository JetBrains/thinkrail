import { Switch } from "@/components/ui/switch";

export function SettingsSwitch({
	checked,
	disabled = false,
	label,
	testId,
	onChange,
}: {
	checked: boolean;
	disabled?: boolean;
	label: string;
	testId: string;
	onChange: (checked: boolean) => void;
}) {
	return (
		<Switch
			checked={checked}
			disabled={disabled}
			aria-label={label}
			data-testid={testId}
			onCheckedChange={onChange}
		/>
	);
}
