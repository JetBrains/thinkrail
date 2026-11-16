import { Keycaps } from "@thinkrail/ui/keycaps";
import { IconTooltip } from "@thinkrail/ui/tooltip";

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
