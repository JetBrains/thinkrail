import { RiArrowDownSLine, RiArrowRightSLine, RiCheckLine } from "@remixicon/react";
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

const PROVIDERS = [
	{
		provider: "anthropic",
		models: [
			{ id: "claude-opus-4", name: "Claude Opus 4", context: "200K" },
			{ id: "claude-sonnet-4", name: "Claude Sonnet 4", context: "200K" },
		],
	},
	{
		provider: "openai",
		models: [
			{ id: "gpt-5", name: "GPT-5", context: "400K" },
			{ id: "gpt-5-mini", name: "GPT-5 mini", context: "400K" },
		],
	},
];

export default function ModelGroups() {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [current, setCurrent] = useState("claude-sonnet-4");
	const [expanded, setExpanded] = useState<string[]>(["anthropic"]);
	const searching = query !== "";
	const toggle = (provider: string) =>
		setExpanded((open) =>
			open.includes(provider) ? open.filter((p) => p !== provider) : [...open, provider],
		);
	const currentName = PROVIDERS.flatMap((group) => group.models).find(
		(model) => model.id === current,
	)?.name;
	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) setQuery("");
			}}
		>
			<PopoverTrigger asChild>
				<Button variant="outline" size="m" iconRight={RiArrowDownSLine}>
					{currentName}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-340 p-0">
				<Command label={t("chat.modelPicker.selectModel")}>
					<CommandInput
						placeholder={t("chat.modelPicker.search")}
						value={query}
						onValueChange={setQuery}
					/>
					<CommandList>
						<CommandEmpty>{t("chat.modelPicker.noMatch")}</CommandEmpty>
						{PROVIDERS.map((group) => {
							const open = searching || expanded.includes(group.provider);
							return (
								<CommandGroup key={group.provider} value={`group:${group.provider}`}>
									<CommandItem
										value={`provider:${group.provider}`}
										keywords={group.models.flatMap((m) => [m.name, m.id])}
										aria-expanded={open}
										onSelect={() => toggle(group.provider)}
										className="gap-8 py-8"
									>
										<span className="min-w-0 flex-1 truncate tr-text-emphasis">
											{group.provider}
										</span>
										<span className="shrink-0 text-text-muted tr-text-metadata">
											{group.models.length}
										</span>
										{open ? (
											<RiArrowDownSLine className="size-14 shrink-0 text-text-muted" />
										) : (
											<RiArrowRightSLine className="size-14 shrink-0 text-text-muted" />
										)}
									</CommandItem>
									{open
										? group.models.map((model) => (
												<CommandItem
													key={model.id}
													value={`all:${model.id}`}
													keywords={[model.name, model.id, group.provider]}
													onSelect={() => {
														setCurrent(model.id);
														setOpen(false);
													}}
													className="ml-24 items-start gap-8"
												>
													<span className="flex min-w-0 flex-1 flex-col">
														<span className="truncate">{model.name}</span>
														<span className="truncate text-text-muted tr-text-metadata">
															{t("chat.modelPicker.context", { size: model.context })}
														</span>
													</span>
													{model.id === current ? (
														<RiCheckLine className="mt-2 size-14 shrink-0 text-primary" />
													) : null}
												</CommandItem>
											))
										: null}
								</CommandGroup>
							);
						})}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
