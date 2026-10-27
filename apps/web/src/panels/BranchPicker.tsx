import {
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiGitBranchLine as GitBranch,
	RiRefreshLine as RefreshCw,
} from "@remixicon/react";
import type { BranchList } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@thinkrail/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { type ReactNode, useState } from "react";
import { remoteBranchPresentation } from "./branchGroups";

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
	triggerClassName?: string;
	refreshing?: boolean;
	container?: HTMLElement | null;
	onSelect: (ref: string) => void;
	onRefresh: () => void;
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const remote = remoteBranchPresentation(branches);
	const local = branches?.local ?? [];
	const defaultBranch = branches?.defaultBranch;

	const renderItem = (ref: string, label = ref) => (
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
			<span className="flex w-14 shrink-0 justify-center">
				{ref === selected ? <Check className="size-14 text-primary" /> : null}
			</span>
			<GitBranch className="size-14 shrink-0 text-text-muted" />
			<span className="truncate tr-text-metadata">{label}</span>
			{ref === defaultBranch ? (
				<span className="ml-auto shrink-0 text-text-muted tr-text-metadata">
					{t("panels.branchPicker.defaultBadge")}
				</span>
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
			{triggerClassName === undefined ? (
				<PopoverTrigger asChild>
					<Button
						variant="ghost"
						size="m"
						iconLeft={GitBranch}
						iconRight={ChevronDown}
						data-testid={testid}
						data-open={open}
						className="min-w-0 max-w-full"
					>
						{label ? <span className="shrink-0">{label}</span> : null}
						<span className="truncate">{selected || t("panels.branchPicker.placeholder")}</span>
					</Button>
				</PopoverTrigger>
			) : (
				<PopoverTrigger data-testid={testid} data-open={open} className={triggerClassName}>
					<GitBranch className="size-14 shrink-0 text-text-muted" />
					<span className="shrink-0 text-text-muted tr-text-metadata">{label}</span>
					<span className="truncate text-text-muted tr-text-metadata">
						{selected || t("panels.branchPicker.placeholder")}
					</span>
					<ChevronDown className="size-16 shrink-0 text-text-muted" />
				</PopoverTrigger>
			)}
			<PopoverContent align="start" container={container} className="w-[320px] p-0">
				<div className="flex items-center justify-end border-border-muted border-b px-8 py-4">
					<IconButton
						icon={RefreshCw}
						label={t("panels.branchPicker.refresh")}
						variant="ghost"
						size="m"
						data-testid="branch-refresh"
						wrapTrigger
						loading={refreshing}
						spinIcon
						onClick={onRefresh}
					/>
				</div>
				<Command>
					<CommandInput placeholder={t("panels.branchPicker.search")} />
					<CommandList>
						<CommandEmpty>{t("panels.branchPicker.empty")}</CommandEmpty>
						{remote.kind === "grouped" ? (
							remote.groups.length > 0 ? (
								<CommandGroup
									heading={t("panels.branchPicker.remote")}
									forceMount
									className="not-has-[[cmdk-group]:not([hidden])]:hidden"
								>
									{remote.groups.map((group) => (
										<CommandGroup
											key={group.remote === null ? "remote:null" : `remote:${group.remote}`}
											heading={group.remote ?? t("panels.branchPicker.otherRemote")}
											className="pl-8"
										>
											{group.branches.map(({ ref, branch }) => renderItem(ref, branch))}
										</CommandGroup>
									))}
								</CommandGroup>
							) : null
						) : remote.refs.length > 0 ? (
							<CommandGroup heading={t("panels.branchPicker.remote")}>
								{remote.refs.map((ref) => renderItem(ref))}
							</CommandGroup>
						) : null}
						{local.length > 0 ? (
							<CommandGroup heading={t("panels.branchPicker.local")}>
								{local.map((ref) => renderItem(ref))}
							</CommandGroup>
						) : null}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
