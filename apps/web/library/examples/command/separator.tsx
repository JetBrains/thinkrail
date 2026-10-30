import { RiAddLine, RiArrowDownSLine, RiFolderLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@thinkrail/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { useState } from "react";

const PROJECTS = ["thinkrail", "website", "design-tokens"];

export default function Separator() {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [project, setProject] = useState("thinkrail");
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="outline" size="m" iconLeft={RiFolderLine} iconRight={RiArrowDownSLine}>
					{project}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-288 p-0">
				<Command label={t("panels.newWorkspace.searchProjects")}>
					<CommandInput placeholder={t("panels.newWorkspace.searchProjects")} />
					<CommandList>
						<CommandEmpty>{t("panels.newWorkspace.noProjects")}</CommandEmpty>
						<CommandGroup>
							{PROJECTS.map((name) => (
								<CommandItem
									key={name}
									value={name}
									onSelect={() => {
										setProject(name);
										setOpen(false);
									}}
								>
									<RiFolderLine className="size-14 shrink-0 text-text-muted" />
									<span className="truncate">{name}</span>
								</CommandItem>
							))}
						</CommandGroup>
						<CommandSeparator />
						<CommandGroup>
							<CommandItem value="action:add" onSelect={() => setOpen(false)}>
								<RiAddLine className="size-14 shrink-0 text-text-muted" />
								<span className="truncate">{t("panels.projectTree.addProject")}</span>
							</CommandItem>
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
