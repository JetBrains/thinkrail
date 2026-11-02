import { RiArrowDownSLine, RiBox3Line } from "@remixicon/react";
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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@thinkrail/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { useState } from "react";

const PROJECTS = Array.from({ length: 14 }, (_, index) => `project-${index + 1}`);

export default function InDialog() {
	const t = useT();
	const [dialogEl, setDialogEl] = useState<HTMLDivElement | null>(null);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [project, setProject] = useState(PROJECTS[0]);
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button variant="outline">{t("panels.newWorkspace.titleIsolated")}</Button>
			</DialogTrigger>
			<DialogContent ref={setDialogEl}>
				<DialogHeader>
					<DialogTitle>{t("panels.newWorkspace.titleIsolated")}</DialogTitle>
					<DialogDescription>{t("panels.newWorkspace.descriptionIsolated")}</DialogDescription>
				</DialogHeader>
				<Popover open={pickerOpen} onOpenChange={setPickerOpen}>
					<PopoverTrigger asChild>
						<Button
							variant="outline"
							size="m"
							iconLeft={RiBox3Line}
							iconRight={RiArrowDownSLine}
							className="self-start"
						>
							{project}
						</Button>
					</PopoverTrigger>
					<PopoverContent
						align="start"
						container={dialogEl}
						aria-label={t("panels.newWorkspace.projectFallback")}
						className="w-288 p-0"
					>
						<Command>
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
												setPickerOpen(false);
											}}
										>
											<RiBox3Line aria-hidden className="size-14 shrink-0 text-text-muted" />
											<span className="truncate">{name}</span>
										</CommandItem>
									))}
								</CommandGroup>
							</CommandList>
						</Command>
					</PopoverContent>
				</Popover>
			</DialogContent>
		</Dialog>
	);
}
