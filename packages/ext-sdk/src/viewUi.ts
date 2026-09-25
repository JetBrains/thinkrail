import type { ExtViewUiExport } from "@thinkrail/contracts";
import type {
	ButtonHTMLAttributes,
	ComponentType,
	HTMLAttributes,
	InputHTMLAttributes,
	ReactNode,
	Ref,
	TextareaHTMLAttributes,
} from "react";

type Div = HTMLAttributes<HTMLDivElement>;

export interface RootProps {
	children?: ReactNode;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	modal?: boolean;
}

export interface TriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	asChild?: boolean;
}

export interface ContentProps extends Div {
	side?: "top" | "right" | "bottom" | "left";
	align?: "start" | "center" | "end";
	sideOffset?: number;
}

export interface MenuItemProps extends Omit<Div, "onSelect"> {
	disabled?: boolean;
	onSelect?: (event: Event) => void;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "default" | "destructive" | "outline" | "ghost";
	size?: "default" | "sm" | "icon";
	ref?: Ref<HTMLButtonElement>;
}

export interface CommandItemProps extends Omit<Div, "onSelect"> {
	value?: string;
	disabled?: boolean;
	onSelect?: (value: string) => void;
}

type UiShape = { [K in ExtViewUiExport]: unknown };

export interface ExtViewUi extends UiShape {
	Button: ComponentType<ButtonProps>;
	Input: ComponentType<InputHTMLAttributes<HTMLInputElement>>;
	Textarea: ComponentType<TextareaHTMLAttributes<HTMLTextAreaElement>>;
	Tooltip: ComponentType<RootProps>;
	TooltipContent: ComponentType<ContentProps>;
	TooltipTrigger: ComponentType<TriggerProps>;
	IconTooltip: ComponentType<{ label: string; children: ReactNode; wrapTrigger?: boolean }>;
	Popover: ComponentType<RootProps>;
	PopoverAnchor: ComponentType<Div & { asChild?: boolean }>;
	PopoverContent: ComponentType<ContentProps>;
	PopoverTrigger: ComponentType<TriggerProps>;
	Dialog: ComponentType<RootProps>;
	DialogClose: ComponentType<TriggerProps>;
	DialogContent: ComponentType<Div & { hideClose?: boolean }>;
	DialogDescription: ComponentType<HTMLAttributes<HTMLParagraphElement>>;
	DialogFooter: ComponentType<Div>;
	DialogHeader: ComponentType<Div>;
	DialogTitle: ComponentType<HTMLAttributes<HTMLHeadingElement>>;
	DialogTrigger: ComponentType<TriggerProps>;
	DropdownMenu: ComponentType<RootProps>;
	DropdownMenuContent: ComponentType<ContentProps>;
	DropdownMenuGroup: ComponentType<Div>;
	DropdownMenuItem: ComponentType<MenuItemProps>;
	DropdownMenuLabel: ComponentType<Div>;
	DropdownMenuSeparator: ComponentType<Div>;
	DropdownMenuTrigger: ComponentType<TriggerProps>;
	ContextMenu: ComponentType<Omit<RootProps, "open" | "defaultOpen">>;
	ContextMenuContent: ComponentType<Div>;
	ContextMenuItem: ComponentType<MenuItemProps>;
	ContextMenuSeparator: ComponentType<Div>;
	ContextMenuTrigger: ComponentType<Div & { asChild?: boolean; disabled?: boolean }>;
	Command: ComponentType<Div & { shouldFilter?: boolean; value?: string; label?: string }>;
	CommandEmpty: ComponentType<Div>;
	CommandGroup: ComponentType<Div & { heading?: ReactNode }>;
	CommandInput: ComponentType<
		Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
			value?: string;
			onValueChange?: (value: string) => void;
		}
	>;
	CommandItem: ComponentType<CommandItemProps>;
	CommandList: ComponentType<Div>;
	CommandSeparator: ComponentType<Div>;
}
