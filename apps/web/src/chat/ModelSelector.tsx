import type { WireModel } from "@thinkrail/contracts";
import { Check, ChevronDown, ChevronsDown } from "lucide-react";
import { useState } from "react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatContextWindow } from "@/lib";

/** A data-derived sub-line for a model row: context window + whether it reasons (extras also name their provider). */
function subLine(model: WireModel, withProvider: boolean): string {
	const parts = withProvider ? [model.provider] : [];
	parts.push(`${formatContextWindow(model.contextWindow)} context`);
	if (model.reasoning) parts.push("reasoning");
	return parts.join(" · ");
}

/**
 * The per-session model picker (cheap win #1): a pill trigger opening a searchable `Command` list.
 *
 * It renders the host's **two tiers** and decides neither: `models` is the everyday list (enabled by the
 * user's allowlist, dated duplicates folded away) and `extra` is everything else, reachable through the
 * "Show all" row — or, at any time, by typing, since a **query searches both tiers** so a legacy or pinned
 * model is never unreachable. Curating the everyday tier lives in Settings → Models, not here.
 *
 * Props-driven, no store — shared by the chat header and the New-Workspace dialog (pre-session mode, where
 * `current` may be null = the host default).
 */
export function ModelSelector({
	models,
	extra,
	current,
	onSelect,
	container,
}: {
	models: WireModel[];
	/** Out-of-list + collapsed models — hidden until "Show all", always searchable. */
	extra: WireModel[];
	current: WireModel | null;
	onSelect: (model: WireModel) => void;
	/** Popover portal target — the host Dialog node when used inside a dialog (so the list scrolls). */
	container?: HTMLElement | null;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [showAll, setShowAll] = useState(false);
	// Typing reveals the extra tier too: cmdk filters the rendered rows, so a search that can't see them
	// would claim "No models found" for a model the host does offer.
	const expanded = showAll || query.trim().length > 0;
	const providers = [...new Set(models.map((m) => m.provider))];

	const reset = (next: boolean) => {
		setOpen(next);
		setQuery("");
		setShowAll(false);
	};

	const select = (model: WireModel) => {
		onSelect(model);
		reset(false);
	};

	const row = (model: WireModel, tier: "primary" | "extra") => {
		const isCurrent = current?.provider === model.provider && current?.id === model.id;
		return (
			<CommandItem
				key={`${model.provider}:${model.id}`}
				value={`${model.provider} ${model.name} ${model.id}`}
				data-testid="model-option"
				data-model-id={model.id}
				data-tier={tier}
				onSelect={() => select(model)}
			>
				<span className="flex w-3.5 shrink-0 justify-center">
					{isCurrent ? <Check className="size-3.5 text-primary" /> : null}
				</span>
				<span className="flex min-w-0 flex-col">
					<span className="truncate">{model.name}</span>
					<span className="truncate text-hint text-xs">{subLine(model, tier === "extra")}</span>
				</span>
				<span className="ml-auto shrink-0 font-[var(--font-mono)] text-hint text-xs">
					{model.id}
				</span>
			</CommandItem>
		);
	};

	return (
		<Popover open={open} onOpenChange={reset}>
			<PopoverTrigger
				data-testid="model-selector"
				data-open={open}
				disabled={models.length === 0 && extra.length === 0}
				className="flex h-8 max-w-[220px] items-center gap-sm rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-sm text-sm text-text outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 data-[open=true]:border-[var(--primary-60)] data-[open=true]:bg-hover"
			>
				<span className="truncate font-[var(--font-mono)] text-muted text-xs">
					{current?.name ?? "Select model"}
				</span>
				<ChevronDown className="size-3 shrink-0 text-hint" />
			</PopoverTrigger>
			<PopoverContent align="start" container={container} className="w-[320px] p-0">
				<Command>
					<CommandInput placeholder="Search models…" value={query} onValueChange={setQuery} />
					<CommandList>
						<CommandEmpty>No models found.</CommandEmpty>
						{providers.map((provider) => (
							<CommandGroup key={provider} heading={provider}>
								{models.filter((m) => m.provider === provider).map((m) => row(m, "primary"))}
							</CommandGroup>
						))}
						{expanded && extra.length > 0 ? (
							<CommandGroup heading="More models">{extra.map((m) => row(m, "extra"))}</CommandGroup>
						) : null}
						{!expanded && extra.length > 0 ? (
							<>
								<CommandSeparator />
								<CommandItem
									data-testid="model-show-all"
									value="show all models"
									onSelect={() => setShowAll(true)}
								>
									<ChevronsDown className="size-3.5 shrink-0 text-hint" />
									<span className="text-muted">Show all {models.length + extra.length} models</span>
								</CommandItem>
							</>
						) : null}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
