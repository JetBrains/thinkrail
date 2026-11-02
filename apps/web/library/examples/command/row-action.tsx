import { RiArrowDownSLine, RiStarFill, RiStarLine } from "@remixicon/react";
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
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";

const MODELS = [
	{ id: "claude-opus-4", name: "Claude Opus 4" },
	{ id: "claude-sonnet-4", name: "Claude Sonnet 4" },
	{ id: "gpt-5", name: "GPT-5" },
];

export default function RowAction() {
	const t = useT();
	const [pinned, setPinned] = useState<string[]>(["claude-sonnet-4"]);
	const [current, setCurrent] = useState("gpt-5");
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="outline" size="m" iconRight={RiArrowDownSLine}>
					{MODELS.find((model) => model.id === current)?.name}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-320 p-0">
				<Command label={t("chat.modelPicker.selectModel")}>
					<CommandInput placeholder={t("chat.modelPicker.search")} />
					<CommandList>
						<CommandEmpty>{t("chat.modelPicker.noMatch")}</CommandEmpty>
						<CommandGroup>
							{MODELS.map((model) => {
								const isPinned = pinned.includes(model.id);
								return (
									<CommandItem
										key={model.id}
										value={model.id}
										keywords={[model.name]}
										onSelect={() => {
											setCurrent(model.id);
											setOpen(false);
										}}
										className="group/row gap-8"
									>
										<span className="min-w-0 flex-1 truncate">{model.name}</span>
										<IconButton
											icon={isPinned ? RiStarFill : RiStarLine}
											size="s"
											label={
												isPinned
													? t("chat.modelPicker.unpin", { model: model.name })
													: t("chat.modelPicker.pin", { model: model.name })
											}
											aria-pressed={isPinned}
											selected={isPinned}
											tone={isPinned ? "warning" : undefined}
											onClick={(event) => {
												event.stopPropagation();
												setPinned((ids) =>
													isPinned ? ids.filter((id) => id !== model.id) : [...ids, model.id],
												);
											}}
											className={cn(
												"shrink-0",
												!isPinned &&
													"opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 group-data-[selected=true]/row:opacity-100",
											)}
										/>
									</CommandItem>
								);
							})}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
