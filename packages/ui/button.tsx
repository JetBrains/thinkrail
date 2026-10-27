import { RiLoader4Line } from "@remixicon/react";
import { cva } from "class-variance-authority";
import type * as React from "react";
import { IconTooltip } from "./tooltip";
import { cn } from "./utils";

export type ButtonVariant = "primary" | "soft-primary" | "outline" | "ghost" | "destructive";
export type ButtonSize = "s" | "m" | "l";
export type ButtonTone = "warning" | "danger";
export type ButtonIcon = React.ElementType<{
	className?: string | undefined;
	"aria-hidden"?: React.AriaAttributes["aria-hidden"];
}>;

const variantClasses = cva(
	[
		"relative inline-flex select-none items-center justify-center whitespace-nowrap rounded-sm border tr-text-button",
		"outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid",
		"button-disabled:pointer-events-none data-[loading=true]:cursor-progress",
		"[&_svg]:pointer-events-none [&_svg]:shrink-0",
	],
	{
		variants: {
			variant: {
				primary:
					"border-transparent bg-control-primary-bg text-control-primary-text hover:bg-control-primary-bg-hovered button-disabled:bg-control-primary-disabled-bg button-disabled:text-control-primary-disabled-text active:bg-control-primary-bg-hovered",
				"soft-primary":
					"border-primary-soft bg-primary-subtle text-primary hover:border-primary-muted hover:bg-control-soft-primary-bg-hovered data-[selected=true]:border-primary-muted data-[selected=true]:bg-control-soft-primary-bg-hovered button-disabled:border-control-disabled-border button-disabled:bg-control-disabled-bg button-disabled:text-control-disabled-text active:border-primary-muted active:bg-control-soft-primary-bg-hovered",
				outline:
					"border-control-border-default bg-control-bg text-text-default hover:bg-control-bg-hovered data-[selected=true]:bg-control-bg-selected button-disabled:border-control-disabled-border button-disabled:bg-control-disabled-bg button-disabled:text-control-disabled-text active:bg-control-bg-hovered",
				ghost: [
					"border-transparent bg-transparent text-text-muted hover:bg-control-bg-hovered hover:text-text-default focus-visible:bg-control-bg-hovered focus-visible:text-text-default data-[selected=true]:bg-control-bg-selected data-[selected=true]:text-text-default button-disabled:text-control-disabled-text active:bg-control-bg-hovered active:text-text-default",
					"[[data-row]_&]:hover:bg-container-elevated-bg [[data-row]_&]:focus-visible:bg-container-elevated-bg [[data-row]_&]:data-[selected=true]:bg-container-elevated-bg [[data-row]_&]:active:bg-container-elevated-bg",
				],
				destructive:
					"border-transparent bg-control-destructive-bg text-control-destructive-text hover:bg-control-destructive-bg-hovered button-disabled:bg-control-destructive-disabled-bg button-disabled:text-control-destructive-disabled-text active:bg-control-destructive-bg-hovered",
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
			tone: {
				neutral: "",
				warning: "",
				danger: "",
			},
		},
		compoundVariants: [
			{ shape: "text", size: "s", className: "h-20 gap-4 px-4" },
			{ shape: "text", size: "m", className: "h-24 gap-4 px-8" },
			{ shape: "text", size: "l", className: "h-32 gap-6 px-12" },
			{ shape: "icon", size: "s", className: "size-20" },
			{ shape: "icon", size: "m", className: "size-24" },
			{ shape: "icon", size: "l", className: "size-32" },
			{ variant: "ghost", shape: "icon", className: "focus-visible:-outline-offset-2" },
			{
				variant: "ghost",
				tone: "warning",
				className:
					"text-feedback-warning hover:text-feedback-warning focus-visible:text-feedback-warning data-[selected=true]:text-feedback-warning active:text-feedback-warning",
			},
			{
				variant: "ghost",
				tone: "danger",
				className:
					"text-feedback-error hover:text-feedback-error focus-visible:text-feedback-error data-[selected=true]:text-feedback-error active:text-feedback-error",
			},
			{ variant: "outline", tone: "warning", className: "text-feedback-warning" },
			{ variant: "outline", tone: "danger", className: "text-feedback-error" },
		],
		defaultVariants: { variant: "primary", size: "l", shape: "text", tone: "neutral" },
	},
);

const ICON_SIZE: Record<ButtonSize, string> = { s: "size-14", m: "size-16", l: "size-20" };

const SPIN = "animate-spin motion-reduce:animate-none";

function Spinner({ size, className }: { size: ButtonSize; className?: string }) {
	return (
		<RiLoader4Line
			aria-hidden
			data-slot="button-spinner"
			className={cn(ICON_SIZE[size], SPIN, className)}
		/>
	);
}

function SpinningIcon({ icon: Icon, size }: { icon: ButtonIcon; size: ButtonSize }) {
	return (
		<>
			<Icon aria-hidden className="motion-safe:animate-spin motion-reduce:hidden" />
			<Spinner size={size} className="motion-safe:hidden" />
		</>
	);
}

export function buttonDataAttributes({
	variant,
	size,
	iconOnly = false,
	selected = false,
}: {
	variant: ButtonVariant;
	size: ButtonSize;
	iconOnly?: boolean;
	selected?: boolean;
}) {
	return {
		"data-slot": "button",
		"data-variant": variant,
		"data-size": size,
		"data-icon-only": iconOnly ? "" : undefined,
		"data-selected": selected ? true : undefined,
	} as const;
}

export function withIconClass(Icon: ButtonIcon, extra: string): ButtonIcon {
	return function IconWithClass({ className, ...props }) {
		return <Icon {...props} className={cn(className, extra)} />;
	};
}

interface SharedProps {
	variant?: ButtonVariant;
	size?: ButtonSize;
	tone?: ButtonTone | undefined;
	selected?: boolean;
	loading?: boolean;
	spinIcon?: boolean;
	ref?: React.Ref<HTMLButtonElement>;
}

interface TooltipProps {
	tooltip?: React.ReactNode;
	tooltipSide?: React.ComponentProps<typeof IconTooltip>["side"];
	tooltipAlign?: React.ComponentProps<typeof IconTooltip>["align"];
	wrapTrigger?: boolean;
}

export interface ButtonProps
	extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title">,
		SharedProps,
		TooltipProps {
	iconLeft?: ButtonIcon;
	iconRight?: ButtonIcon;
}

function withTooltip(
	trigger: React.ReactElement,
	label: React.ReactNode,
	side: TooltipProps["tooltipSide"] | undefined,
	align: TooltipProps["tooltipAlign"] | undefined,
	wrap: boolean,
) {
	return (
		<IconTooltip
			label={label}
			{...(side ? { side } : {})}
			{...(align ? { align } : {})}
			{...(wrap ? { wrapTrigger: true } : {})}
		>
			{trigger}
		</IconTooltip>
	);
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
	tone,
	iconLeft: IconLeft,
	iconRight: IconRight,
	selected,
	loading,
	spinIcon,
	tooltip,
	tooltipSide,
	tooltipAlign,
	wrapTrigger,
	type = "button",
	children,
	ref,
	...props
}: ButtonProps) {
	const spinnerReplacesIcon = loading && (IconLeft || IconRight);
	const button = (
		<button
			ref={ref}
			type={type}
			{...buttonDataAttributes({ variant, size })}
			className={cn(variantClasses({ variant, size, shape: "text", tone }), className)}
			{...props}
			{...stateProps(props, selected, loading)}
		>
			{IconLeft ? (
				loading ? (
					spinIcon ? (
						<SpinningIcon icon={IconLeft} size={size} />
					) : (
						<Spinner size={size} />
					)
				) : (
					<IconLeft aria-hidden />
				)
			) : null}
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
					spinIcon ? (
						<SpinningIcon icon={IconRight} size={size} />
					) : (
						<Spinner size={size} />
					)
				) : (
					<IconRight aria-hidden />
				)
			) : null}
		</button>
	);
	if (tooltip === undefined) return button;
	return withTooltip(
		button,
		tooltip,
		tooltipSide,
		tooltipAlign,
		wrapTrigger ?? props.disabled === true,
	);
}

export interface IconButtonProps
	extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label" | "title">,
		SharedProps,
		TooltipProps {
	icon: ButtonIcon;
	label: string;
}

export function IconButton({
	className,
	variant = "ghost",
	size = "m",
	tone,
	icon: Icon,
	label,
	tooltip,
	tooltipSide,
	tooltipAlign,
	wrapTrigger,
	selected,
	loading,
	spinIcon,
	type = "button",
	ref,
	...props
}: IconButtonProps) {
	return withTooltip(
		<button
			ref={ref}
			type={type}
			aria-label={label}
			{...buttonDataAttributes({ variant, size, iconOnly: true })}
			className={cn(variantClasses({ variant, size, shape: "icon", tone }), className)}
			{...props}
			{...stateProps(props, selected, loading)}
		>
			{loading ? (
				spinIcon ? (
					<SpinningIcon icon={Icon} size={size} />
				) : (
					<Spinner size={size} />
				)
			) : (
				<Icon aria-hidden />
			)}
		</button>,
		tooltip ?? label,
		tooltipSide,
		tooltipAlign,
		wrapTrigger ?? props.disabled === true,
	);
}

export function buttonVariants(options?: Parameters<typeof variantClasses>[0]): string {
	return cn(variantClasses(options));
}
