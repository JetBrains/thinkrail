import type { RemixiconComponentType } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { type ComponentPropsWithoutRef, forwardRef } from "react";

export function CardSkeleton() {
	const t = useT();
	return (
		<div
			role="status"
			aria-label={t("panels.welcome.loading")}
			aria-busy="true"
			className="flex h-[150px] w-[220px] flex-col items-start justify-between rounded-sm border border-border-default bg-container-workspace-bg p-16"
		>
			<span className="size-24 shrink-0 animate-pulse rounded-full bg-control-bg-hovered" />
			<span className="flex w-full flex-col gap-8">
				<span className="h-3 w-3/4 animate-pulse rounded-sm bg-control-bg-hovered" />
				<span className="h-3 w-full animate-pulse rounded-sm bg-control-bg-hovered" />
			</span>
		</div>
	);
}

type CardProps = {
	cta?: boolean;
	primary?: boolean;
	icon: RemixiconComponentType;
	title: string;
	subtitle: string;
	tag?: string;
} & ComponentPropsWithoutRef<"button">;

export const Card = forwardRef<HTMLButtonElement, CardProps>(function Card(
	{ cta, primary, icon: Icon, title, subtitle, tag, className, ...rest },
	ref,
) {
	return (
		<button
			ref={ref}
			type="button"
			data-testid={cta ? "welcome-cta" : "welcome-action"}
			{...rest}
			className={cn(
				"relative flex h-[150px] w-[220px] flex-col items-start justify-between rounded-sm border bg-clip-padding p-16 text-left transition-colors",
				primary
					? "border-primary-muted bg-primary-subtle hover:bg-primary-soft"
					: "border-border-default bg-container-workspace-bg hover:border-primary-muted hover:bg-container-elevated-bg",
				className,
			)}
		>
			{tag ? (
				<span className="absolute top-12 right-12 rounded-full border border-primary-muted bg-clip-padding bg-primary-subtle px-8 py-2 tr-text-label-pill text-primary">
					{tag}
				</span>
			) : null}
			<Icon className={cn("size-24", primary ? "text-primary" : "text-text-muted")} />
			<span className="w-full">
				<span className="block tr-title-card text-text-default">{title}</span>
				<span className="mt-2 block text-text-muted tr-text-metadata leading-snug">{subtitle}</span>
			</span>
		</button>
	);
});
