import { IconTooltip } from "@thinkrail/ui/tooltip";

export function Keycaps({ keys }: { keys: readonly string[] }) {
	return (
		<span className="flex shrink-0 items-center gap-2">
			{keys.map((key) => (
				<kbd
					key={key}
					className="inline-flex h-16 min-w-16 items-center justify-center rounded-xs border border-border-default px-4 tr-text-metadata text-text-muted"
				>
					{key}
				</kbd>
			))}
		</span>
	);
}

export function KeyHint({ keys, label }: { keys: readonly string[]; label: string }) {
	return (
		<IconTooltip label={label} side="top">
			<span className="flex shrink-0 items-center gap-4">
				<Keycaps keys={keys} />
				<span className="hidden @[296px]:inline">{label}</span>
			</span>
		</IconTooltip>
	);
}
