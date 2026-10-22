import { RiLoader4Line } from "@remixicon/react";
import { cva } from "class-variance-authority";
import type * as React from "react";
import { IconTooltip } from "./tooltip";
import { cn } from "./utils";

export type ButtonVariant = "primary" | "soft-primary" | "outline" | "ghost" | "destructive";
export type ButtonSize = "s" | "m" | "l";
export type ButtonIcon = React.ElementType<{
	className?: string | undefined;
	"aria-hidden"?: React.AriaAttributes["aria-hidden"];
}>;

const buttonVariants = cva(
	[
		"relative inline-flex select-none items-center justify-center whitespace-nowrap rounded-sm border tr-text-button",
		"outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid",
		"data-[disabled=true]:pointer-events-none data-[loading=true]:cursor-progress",
		"[&_svg]:pointer-events-none [&_svg]:shrink-0",
	],
	{
		variants: {
			variant: {
				primary:
					"border-transparent bg-control-primary-bg text-control-primary-text hover:bg-control-primary-bg-hovered data-[disabled=true]:bg-control-primary-disabled-bg data-[disabled=true]:text-control-primary-disabled-text active:bg-control-primary-bg-hovered",
				"soft-primary":
					"border-primary-soft bg-primary-subtle text-primary hover:border-primary-muted hover:bg-control-soft-primary-bg-hovered data-[disabled=true]:border-control-disabled-border data-[disabled=true]:bg-control-disabled-bg data-[disabled=true]:text-control-disabled-text active:border-primary-muted active:bg-control-soft-primary-bg-hovered",
				outline:
					"border-control-border-default bg-control-bg text-text-default hover:bg-control-bg-hovered data-[selected=true]:bg-control-bg-selected data-[disabled=true]:border-control-disabled-border data-[disabled=true]:bg-control-disabled-bg data-[disabled=true]:text-control-disabled-text active:bg-control-bg-hovered",
				ghost:
					"border-transparent bg-transparent text-text-muted hover:bg-control-bg-hovered hover:text-text-default focus-visible:bg-control-bg-hovered focus-visible:text-text-default data-[selected=true]:bg-control-bg-selected data-[selected=true]:text-text-default data-[disabled=true]:text-control-disabled-text active:bg-control-bg-hovered active:text-text-default",
				destructive:
					"border-transparent bg-control-destructive-bg text-control-destructive-text hover:bg-control-destructive-bg-hovered data-[disabled=true]:bg-control-destructive-disabled-bg data-[disabled=true]:text-control-destructive-disabled-text active:bg-control-destructive-bg-hovered",
			},
			size: {
				s: "[&_svg]:size-14",
				m: "[&_svg]:size-16",
				l: "[&_svg]:size-20",
			},
			shape: {
				text: "",
				icon: "p-0",
			},
		},
		compoundVariants: [
			{ shape: "text", size: "s", className: "h-20 gap-4 px-4" },
			{ shape: "text", size: "m", className: "h-24 gap-4 px-8" },
			{ shape: "text", size: "l", className: "h-32 gap-6 px-12" },
			{ shape: "icon", size: "s", className: "size-20" },
			{ shape: "icon", size: "m", className: "size-24" },
			{ shape: "icon", size: "l", className: "size-32" },
		],
		defaultVariants: { variant: "primary", size: "l", shape: "text" },
	},
);

const ICON_SIZE: Record<ButtonSize, string> = { s: "size-14", m: "size-16", l: "size-20" };

function Spinner({ size }: { size: ButtonSize }) {
	return (
		<RiLoader4Line
			aria-hidden
			data-slot="button-spinner"
			className={cn(ICON_SIZE[size], "animate-spin motion-reduce:animate-none")}
		/>
	);
}

interface SharedProps {
	variant?: ButtonVariant;
	size?: ButtonSize;
	/** Persistent selected/open state (toggles, open menus). Never the transient pressed state. */
	selected?: boolean;
	/** Shows a spinner at icon size, keeps the geometry, and blocks re-activation. */
	loading?: boolean;
	ref?: React.Ref<HTMLButtonElement>;
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, SharedProps {
	iconLeft?: ButtonIcon;
	iconRight?: ButtonIcon;
}

function stateProps(
	props: { disabled?: boolean | undefined; "data-state"?: unknown },
	selected: boolean | undefined,
	loading: boolean | undefined,
) {
	const open = props["data-state"] === "open";
	return {
		disabled: props.disabled || loading,
		"data-disabled": props.disabled && !loading ? true : undefined,
		"data-loading": loading ? true : undefined,
		"data-selected": selected || open ? true : undefined,
		"aria-busy": loading ? true : undefined,
	};
}

export function Button({
	className,
	variant = "primary",
	size = "l",
	iconLeft: IconLeft,
	iconRight: IconRight,
	selected,
	loading,
	type = "button",
	children,
	ref,
	...props
}: ButtonProps) {
	const spinnerReplacesIcon = loading && (IconLeft || IconRight);
	return (
		<button
			ref={ref}
			type={type}
			data-slot="button"
			data-variant={variant}
			data-size={size}
			className={cn(buttonVariants({ variant, size, shape: "text" }), className)}
			{...props}
			{...stateProps(props, selected, loading)}
		>
			{IconLeft ? loading ? <Spinner size={size} /> : <IconLeft aria-hidden /> : null}
			{loading && !spinnerReplacesIcon ? (
				<>
					<span className="contents text-transparent">{children}</span>
					<span className="absolute inset-0 flex items-center justify-center">
						<Spinner size={size} />
					</span>
				</>
			) : (
				children
			)}
			{IconRight ? (
				loading && !IconLeft ? (
					<Spinner size={size} />
				) : (
					<IconRight aria-hidden />
				)
			) : null}
		</button>
	);
}

export interface IconButtonProps
	extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label">,
		SharedProps {
	icon: ButtonIcon;
	/** Accessible name; also the tooltip text unless `tooltip` overrides it. */
	label: string;
	tooltip?: React.ReactNode;
	tooltipSide?: React.ComponentProps<typeof IconTooltip>["side"];
	tooltipAlign?: React.ComponentProps<typeof IconTooltip>["align"];
	/** Wrap the tooltip trigger in a span (disabled buttons, or another Radix trigger on the same element). */
	wrapTrigger?: boolean;
}

export function IconButton({
	className,
	variant = "ghost",
	size = "m",
	icon: Icon,
	label,
	tooltip,
	tooltipSide,
	tooltipAlign,
	wrapTrigger,
	selected,
	loading,
	type = "button",
	ref,
	...props
}: IconButtonProps) {
	return (
		<IconTooltip
			label={tooltip ?? label}
			{...(tooltipSide ? { side: tooltipSide } : {})}
			{...(tooltipAlign ? { align: tooltipAlign } : {})}
			{...(wrapTrigger ? { wrapTrigger } : {})}
		>
			<button
				ref={ref}
				type={type}
				aria-label={label}
				data-slot="button"
				data-variant={variant}
				data-size={size}
				data-icon-only=""
				className={cn(buttonVariants({ variant, size, shape: "icon" }), className)}
				{...props}
				{...stateProps(props, selected, loading)}
			>
				{loading ? <Spinner size={size} /> : <Icon aria-hidden />}
			</button>
		</IconTooltip>
	);
}

export { buttonVariants };
