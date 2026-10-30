import { RiArrowDownSLine, RiCheckLine, RiGitBranchLine, RiRefreshLine } from "@remixicon/react";
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
import { useState } from "react";

const REMOTE = ["origin/main", "origin/release/1.4"];
const LOCAL = ["main", "feature/popover-docs", "fix/flaky-login"];

export default function Picker() {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [selected, setSelected] = useState("origin/main");
	const [refreshing, setRefreshing] = useState(false);
	const refresh = () => {
		setRefreshing(true);
		setTimeout(() => setRefreshing(false), 1200);
	};
	const item = (ref: string) => (
		<CommandItem
			key={ref}
			value={ref}
			onSelect={() => {
				setSelected(ref);
				setOpen(false);
			}}
		>
			<span className="min-w-0 flex-1 truncate">{ref}</span>
			{ref === selected ? <RiCheckLine aria-hidden className="size-14 text-primary" /> : null}
		</CommandItem>
	);
	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) refresh();
			}}
		>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="m" iconLeft={RiGitBranchLine} iconRight={RiArrowDownSLine}>
					{selected}
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				aria-label={t("shell.location.branch.caption")}
				className="w-320 p-0"
			>
				<div className="flex items-center justify-end border-border-muted border-b py-4 pr-8 pl-12">
					<IconButton
						icon={RiRefreshLine}
						label={t("panels.branchPicker.refresh")}
						wrapTrigger
						loading={refreshing}
						spinIcon
						onClick={refresh}
					/>
				</div>
				<Command>
					<CommandInput placeholder={t("panels.branchPicker.search")} />
					<CommandList>
						<CommandEmpty>{t("panels.branchPicker.empty")}</CommandEmpty>
						<CommandGroup heading={t("panels.branchPicker.remote")}>
							{REMOTE.map(item)}
						</CommandGroup>
						<CommandGroup heading={t("panels.branchPicker.local")}>{LOCAL.map(item)}</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
