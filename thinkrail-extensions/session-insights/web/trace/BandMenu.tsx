import { RiArrowDownSLine } from "@remixicon/react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { cn } from "@thinkrail/ui/utils";
import { type BandPick, samePick } from "./bands";

export interface BandMenuItem {
	key: string;
	label: string;
	pick: BandPick;
}

/** The keyboard way to a plan step or skill on a canvas band: a menu that picks it. */
export function BandMenu({
	testId,
	label,
	items,
	current,
	onPick,
}: {
	testId: string;
	label: string;
	items: readonly BandMenuItem[];
	current: BandPick | null;
	onPick: (pick: BandPick) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					data-testid={testId}
					className="flex h-18 shrink-0 items-center gap-2 truncate rounded-sm text-left text-text-muted hover:text-text-default focus-visible:focus-ring"
				>
					<span className="truncate">{label}</span>
					<RiArrowDownSLine aria-hidden className="size-12 shrink-0" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="max-w-480">
				<DropdownMenuLabel>{label}</DropdownMenuLabel>
				{items.map((item) => (
					<DropdownMenuItem
						key={item.key}
						data-testid={`${testId}-item`}
						data-active={samePick(current, item.pick) ? "true" : undefined}
						onSelect={() => onPick(item.pick)}
						className={cn(samePick(current, item.pick) && "bg-control-bg-selected")}
					>
						<span className="truncate">{item.label}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
