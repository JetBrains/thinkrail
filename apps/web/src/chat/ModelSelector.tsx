import type { Model } from "@thinkrail-pi/contracts";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** A model's context window as a compact label, e.g. 1_000_000 → "1M", 200_000 → "200K". */
function formatContext(tokens: number): string {
	if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`.replace(".0", "");
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
	return String(tokens);
}

/** A data-derived sub-line for a model row: context window + whether it reasons. */
function subLine(model: Model<string>): string {
	const parts = [`${formatContext(model.contextWindow)} context`];
	if (model.reasoning) parts.push("reasoning");
	return parts.join(" · ");
}

/**
 * The per-session model picker (cheap win #1): a pill trigger opening a searchable
 * `Command` list grouped by provider. Props-driven, no store — shared by the chat header and the
 * New-Workspace dialog (pre-session mode, where `current` may be null = the host default).
 */
export function ModelSelector({
	models,
	current,
	onSelect,
	container,
}: {
	models: Model<string>[];
	current: Model<string> | null;
	onSelect: (model: Model<string>) => void;
	/** Popover portal target — the host Dialog node when used inside a dialog (so the list scrolls). */
	container?: HTMLElement | null;
}) {
	const [open, setOpen] = useState(false);
	const providers = [...new Set(models.map((m) => m.provider))];

	const select = (model: Model<string>) => {
		onSelect(model);
		setOpen(false);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				data-testid="model-selector"
				data-open={open}
				disabled={models.length === 0}
				className="flex h-8 max-w-[220px] items-center gap-sm rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-sm text-sm text-text outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 data-[open=true]:border-[var(--primary-60)] data-[open=true]:bg-hover"
			>
				<span className="truncate font-[var(--font-mono)] text-muted text-xs">
					{current?.name ?? "Select model"}
				</span>
				<ChevronDown className="size-3 shrink-0 text-hint" />
			</PopoverTrigger>
			<PopoverContent align="start" container={container} className="w-[320px] p-0">
				<Command>
					<CommandInput placeholder="Search models…" />
					<CommandList>
						<CommandEmpty>No models found.</CommandEmpty>
						{providers.map((provider) => (
							<CommandGroup key={provider} heading={provider}>
								{models
									.filter((m) => m.provider === provider)
									.map((m) => {
										const isCurrent = current?.provider === m.provider && current?.id === m.id;
										return (
											<CommandItem
												key={`${m.provider}:${m.id}`}
												value={`${m.provider} ${m.name} ${m.id}`}
												data-testid="model-option"
												data-model-id={m.id}
												onSelect={() => select(m)}
											>
												<span className="flex w-3.5 shrink-0 justify-center">
													{isCurrent ? <Check className="size-3.5 text-primary" /> : null}
												</span>
												<span className="flex min-w-0 flex-col">
													<span className="truncate">{m.name}</span>
													<span className="truncate text-hint text-xs">{subLine(m)}</span>
												</span>
												<span className="ml-auto shrink-0 font-[var(--font-mono)] text-hint text-xs">
													{m.id}
												</span>
											</CommandItem>
										);
									})}
							</CommandGroup>
						))}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
