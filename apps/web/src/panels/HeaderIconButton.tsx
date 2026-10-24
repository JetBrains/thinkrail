import { type ButtonIcon, IconButton } from "@thinkrail/ui/button";

export function HeaderIconButton({
	testid,
	label,
	active,
	disabled,
	onClick,
	icon,
}: {
	testid: string;
	label: string;
	active?: boolean;
	disabled?: boolean;
	onClick: () => void;
	icon: ButtonIcon;
}) {
	return (
		<IconButton
			icon={icon}
			label={label}
			variant="ghost"
			size="m"
			selected={active === true}
			data-testid={testid}
			data-active={active}
			aria-pressed={active}
			disabled={disabled}
			onClick={onClick}
		/>
	);
}
