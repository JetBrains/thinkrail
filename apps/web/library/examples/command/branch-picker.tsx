import { RiArrowDownSLine, RiCheckLine, RiGitBranchLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
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

const REMOTES = [
	{ remote: "origin", branches: ["main", "release-2.4"] },
	{ remote: "upstream", branches: ["main"] },
];
const LOCAL = ["main", "feature/command-docs"];
const DEFAULT_BRANCH = "origin/main";

export default function BranchPicker() {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [selected, setSelected] = useState("main");

	const row = (ref: string, label = ref) => (
		<CommandItem
			key={ref}
			value={ref}
			onSelect={() => {
				setSelected(ref);
				setOpen(false);
			}}
		>
			<span className="flex w-14 shrink-0 justify-center">
				{ref === selected ? <RiCheckLine className="size-14 text-primary" /> : null}
			</span>
			<RiGitBranchLine className="size-14 shrink-0 text-text-muted" />
			<span className="truncate tr-text-metadata">{label}</span>
			{ref === DEFAULT_BRANCH ? (
				<span className="ml-auto shrink-0 text-text-muted tr-text-metadata">
					{t("panels.branchPicker.defaultBadge")}
				</span>
			) : null}
		</CommandItem>
	);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="m" iconLeft={RiGitBranchLine} iconRight={RiArrowDownSLine}>
					{selected}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-320 p-0">
				<Command label={t("panels.branchPicker.search")}>
					<CommandInput placeholder={t("panels.branchPicker.search")} />
					<CommandList>
						<CommandEmpty>{t("panels.branchPicker.empty")}</CommandEmpty>
						<CommandGroup
							heading={t("panels.branchPicker.remote")}
							forceMount
							className="not-has-[[cmdk-group]:not([hidden])]:hidden"
						>
							{REMOTES.map((group) => (
								<CommandGroup key={group.remote} heading={group.remote} className="pl-8">
									{group.branches.map((branch) => row(`${group.remote}/${branch}`, branch))}
								</CommandGroup>
							))}
						</CommandGroup>
						<CommandGroup heading={t("panels.branchPicker.local")}>
							{LOCAL.map((ref) => row(ref))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
