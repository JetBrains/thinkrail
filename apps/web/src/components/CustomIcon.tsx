import { cn } from "@/lib";

export type CustomIconName = "file-diff-line" | "file-diff-fill";

export function CustomIcon({
	name,
	className,
}: {
	name: CustomIconName;
	className?: string | undefined;
}) {
	return (
		<span aria-hidden="true" className={cn("custom-icon", `custom-icon-${name}`, className)} />
	);
}
