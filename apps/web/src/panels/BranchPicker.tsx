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

/**
 * A branch combobox: searchable, grouped **Remote** / **Local**, the current pick check-marked, with a
 * Refresh that re-lists. One definition for both places the app picks a ref — the New-Workspace dialog's
 * *base* branch (what a worktree is cut from) and the Changes header's *target* branch (what its diff is
 * measured against) — so the two never drift in behaviour or degradation (an offline/failed list arrives
 * empty via `listBranchesOrEmpty` and the popover simply says so).
 *
 * Presentational: the caller owns the fetch, the trigger's look (`triggerClassName`) and its `label`, and
 * what a pick means. `container` portals the popover into a host node (pass a Dialog's node so the list
 * stays scrollable under its scroll lock).
 */
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
	/** `null` while the list is loading — the popover then shows its empty state. */
	branches: BranchList | null;
	selected: string;
	/** Short prefix in front of the ref ("From" / "vs"), naming what the ref *is* to this surface. */
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
			<GitBranch className="size-3.5 shrink-0 text-hint" />
			<span className="truncate tr-text-metadata">{ref}</span>
			{ref === defaultBranch ? (
				<span className="ml-auto shrink-0 text-hint tr-text-metadata">default</span>
			) : null}
		</CommandItem>
	);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger data-testid={testid} data-open={open} className={triggerClassName}>
				<GitBranch className="size-3.5 shrink-0 text-muted" />
				<span className="shrink-0 text-hint tr-text-metadata">{label}</span>
				<span className="truncate text-muted tr-text-metadata">{selected || "branch"}</span>
				<ChevronDown className="size-3 shrink-0 text-hint" />
			</PopoverTrigger>
			<PopoverContent align="start" container={container} className="w-[320px] p-0">
				<div className="flex items-center justify-end border-border border-b px-sm py-xs">
					<button
						type="button"
						data-testid="branch-refresh"
						aria-label="Refresh branches"
						title="Refresh branches"
						onClick={onRefresh}
						className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-hint outline-none transition-colors hover:bg-hover hover:text-muted focus-visible:ring-2 focus-visible:ring-primary"
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
