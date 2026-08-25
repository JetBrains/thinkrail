import type { BranchList } from "@thinkrail/contracts";
import { Check, ChevronDown, GitBranch, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function BranchPicker({
	branches,
	selected,
	label,
	testid,
	triggerClassName,
	refreshing = false,
	container = null,
	onSelect,
	onRefresh,
}: {
	branches: BranchList | null;
	selected: string;
	label: ReactNode;
	testid: string;
	triggerClassName: string;
	refreshing?: boolean;
	container?: HTMLElement | null;
	onSelect: (ref: string) => void;
	onRefresh: () => void;
}) {
	const [open, setOpen] = useState(false);
	const remote = branches?.remote ?? [];
	const local = branches?.local ?? [];
	const defaultBranch = branches?.defaultBranch;

	const renderItem = (ref: string) => (
		<CommandItem
			key={ref}
			value={ref}
			data-testid="branch-option"
			data-branch={ref}
			data-active={ref === selected ? true : undefined}
			onSelect={() => {
				onSelect(ref);
				setOpen(false);
			}}
		>
			<span className="flex w-3.5 shrink-0 justify-center">
				{ref === selected ? <Check className="size-3.5 text-primary" /> : null}
			</span>
			<GitBranch className="size-3.5 shrink-0 text-text-muted" />
			<span className="truncate tr-text-metadata">{ref}</span>
			{ref === defaultBranch ? (
				<span className="ml-auto shrink-0 text-text-muted tr-text-metadata">default</span>
			) : null}
		</CommandItem>
	);

	return (
		<Popover
			open={open}
			onOpenChange={(nextOpen) => {
				setOpen(nextOpen);
				if (nextOpen) onRefresh();
			}}
		>
			<PopoverTrigger data-testid={testid} data-open={open} className={triggerClassName}>
				<GitBranch className="size-3.5 shrink-0 text-text-muted" />
				<span className="shrink-0 text-text-muted tr-text-metadata">{label}</span>
				<span className="truncate text-text-muted tr-text-metadata">{selected || "branch"}</span>
				<ChevronDown className="size-3 shrink-0 text-text-muted" />
			</PopoverTrigger>
			<PopoverContent align="start" container={container} className="w-[320px] p-0">
				<div className="flex items-center justify-end border-border-muted border-b px-sm py-xs">
					<button
						type="button"
						data-testid="branch-refresh"
						aria-label="Refresh branches"
						title="Refresh branches"
						onClick={onRefresh}
						className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
					>
						<RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
					</button>
				</div>
				<Command>
					<CommandInput placeholder="Search branches…" />
					<CommandList>
						<CommandEmpty>No branches found.</CommandEmpty>
						{remote.length > 0 ? (
							<CommandGroup heading="Remote">{remote.map(renderItem)}</CommandGroup>
						) : null}
						{local.length > 0 ? (
							<CommandGroup heading="Local">{local.map(renderItem)}</CommandGroup>
						) : null}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
