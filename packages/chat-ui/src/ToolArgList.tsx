import { cn } from "@thinkrail/ui/utils";
import { Fragment, type HTMLAttributes } from "react";

export interface ToolArgEntry {
	key: string;
	value: string;
}

export function toolArgEntries(args: Record<string, unknown>): ToolArgEntry[] {
	return Object.entries(args).map(([key, value]) => ({
		key,
		value: typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value)),
	}));
}

export function ToolArgList({
	entries,
	className,
	...rest
}: { entries: ToolArgEntry[] } & HTMLAttributes<HTMLDListElement> & { "data-testid"?: string }) {
	return (
		<dl
			{...rest}
			className={cn("grid grid-cols-[auto_minmax(0,1fr)] gap-x-8 gap-y-2 tr-code-text", className)}
		>
			{entries.map(({ key, value }) => (
				<Fragment key={key}>
					<dt className="text-text-muted">{key}</dt>
					<dd className="min-w-0 whitespace-pre-wrap break-words text-text-default">{value}</dd>
				</Fragment>
			))}
		</dl>
	);
}
