import { RiArrowDownSLine, RiGitBranchLine } from "@remixicon/react";
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

const REMOTE = ["origin/main", "origin/release-2.4"];
const LOCAL = ["main", "feature/command-docs"];

export default function Preview() {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [selected, setSelected] = useState("main");
	const row = (ref: string) => (
		<CommandItem
			key={ref}
			value={ref}
			onSelect={() => {
				setSelected(ref);
				setOpen(false);
			}}
		>
			<RiGitBranchLine className="size-14 shrink-0 text-text-muted" />
			<span className="truncate">{ref}</span>
		</CommandItem>
	);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="outline" size="m" iconLeft={RiGitBranchLine} iconRight={RiArrowDownSLine}>
					{selected}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-288 p-0">
				<Command label={t("panels.branchPicker.search")}>
					<CommandInput placeholder={t("panels.branchPicker.search")} />
					<CommandList>
						<CommandEmpty>{t("panels.branchPicker.empty")}</CommandEmpty>
						<CommandGroup heading={t("panels.branchPicker.remote")}>{REMOTE.map(row)}</CommandGroup>
						<CommandGroup heading={t("panels.branchPicker.local")}>{LOCAL.map(row)}</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
