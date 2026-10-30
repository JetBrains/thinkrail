import { RiSearchLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@thinkrail/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { useRef, useState } from "react";

const TABS = ["Composer.tsx", "README.md", "Terminal 1"];

export default function CloseFocus() {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState("Composer.tsx");
	const tabRefs = useRef(new Map<string, HTMLButtonElement>());
	const focusTarget = useRef<string | null>(null);
	return (
		<div className="flex flex-wrap items-center gap-4">
			{TABS.map((tab) => (
				<Button
					key={tab}
					ref={(node) => {
						if (node) tabRefs.current.set(tab, node);
						else tabRefs.current.delete(tab);
					}}
					variant="ghost"
					size="m"
					selected={tab === active}
					aria-pressed={tab === active}
					onClick={() => setActive(tab)}
				>
					{tab}
				</Button>
			))}
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<IconButton icon={RiSearchLine} label={t("workbench.tabs.search")} wrapTrigger />
				</PopoverTrigger>
				<PopoverContent
					align="end"
					aria-label={t("workbench.tabs.search")}
					className="w-288 p-0"
					onCloseAutoFocus={(event) => {
						const target = focusTarget.current;
						if (!target) return;
						focusTarget.current = null;
						event.preventDefault();
						tabRefs.current.get(target)?.focus();
					}}
				>
					<Command>
						<CommandInput placeholder={t("workbench.tabs.findPlaceholder")} />
						<CommandList>
							<CommandEmpty>{t("workbench.tabs.noMatches")}</CommandEmpty>
							{TABS.map((tab) => (
								<CommandItem
									key={tab}
									value={tab}
									onSelect={() => {
										focusTarget.current = tab;
										setActive(tab);
										setOpen(false);
									}}
								>
									<span className="truncate">{tab}</span>
								</CommandItem>
							))}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	);
}
