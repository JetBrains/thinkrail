import {
	RiChat3Line,
	RiFileTextLine,
	RiGitPullRequestLine,
	RiSearchLine,
	RiTerminalBoxLine,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@thinkrail/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { useState } from "react";

const TABS = [
	{ id: "chat:1", name: "Fix the flaky login test", kind: "chat", icon: RiChat3Line },
	{ id: "file:1", name: "command.tsx", kind: "packages/ui/command.tsx", icon: RiFileTextLine },
	{ id: "terminal:1", name: "bun test", kind: "terminal", icon: RiTerminalBoxLine },
	{ id: "changes:1", name: "Changes", kind: "diff review", icon: RiGitPullRequestLine },
];

export default function TabSearch() {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(TABS[0]?.id);
	return (
		<div className="flex items-center gap-8">
			<span className="tr-text-metadata text-text-muted">
				{TABS.find((tab) => tab.id === active)?.name}
			</span>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<IconButton icon={RiSearchLine} label={t("workbench.tabs.search")} wrapTrigger />
				</PopoverTrigger>
				<PopoverContent align="end" className="w-288 p-0">
					<Command label={t("workbench.tabs.search")}>
						<CommandInput placeholder={t("workbench.tabs.findPlaceholder")} />
						<CommandList>
							<CommandEmpty>{t("workbench.tabs.noMatches")}</CommandEmpty>
							{TABS.map((tab) => (
								<CommandItem
									key={tab.id}
									value={tab.id}
									keywords={[tab.name, tab.kind]}
									onSelect={() => {
										setActive(tab.id);
										setOpen(false);
									}}
								>
									<tab.icon className="size-14 shrink-0 text-text-muted" />
									<span className="truncate">{tab.name}</span>
								</CommandItem>
							))}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	);
}
