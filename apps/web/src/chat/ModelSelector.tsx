import type { WireModel } from "@thinkrail/contracts";
import { Check, ChevronDown, RefreshCw } from "lucide-react";
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
import { cn } from "@/lib";

/** A model's context window as a compact label, e.g. 1_000_000 → "1M", 200_000 → "200K". */
function formatContext(tokens: number): string {
	if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`.replace(".0", "");
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
	return String(tokens);
}

/** A data-derived sub-line for a model row: context window + whether it reasons. */
function subLine(model: WireModel): string {
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
	refreshing,
	onRefresh,
	container,
}: {
	models: WireModel[];
	current: WireModel | null;
	onSelect: (model: WireModel) => void;
	/** The awaited catalog refresh is in flight — spins the footer row (freshness affordance). */
	refreshing: boolean;
	/** Bring the catalog up to date. The footer row passes `force: true` — the user asked, so bypass pi's
	 * freshness throttle and spin while it runs; opening the popover passes `false`, which the caller
	 * serves from the host's snapshot so an open never blocks on the network. */
	onRefresh: (force: boolean) => void;
	/** Popover portal target — the host Dialog node when used inside a dialog (so the list scrolls). */
	container?: HTMLElement | null;
}) {
	const [open, setOpen] = useState(false);
	const providers = [...new Set(models.map((m) => m.provider))];

	const select = (model: WireModel) => {
		onSelect(model);
		setOpen(false);
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				// Unforced: picks up whatever a prior refresh landed, without a network round trip.
				if (next) onRefresh(false);
			}}
		>
			{/* Always openable, even with an empty catalog — that is precisely when the footer's Refresh
			    row is the thing to reach for. */}
			<PopoverTrigger
				data-testid="model-selector"
				data-open={open}
				className="flex h-8 max-w-[220px] items-center gap-sm rounded-[var(--radius-md)] border border-control-border-default bg-clip-padding bg-control-bg px-sm tr-text-ui text-text-default outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:border-control-border-active data-[open=true]:bg-control-bg-selected"
			>
				<span className="truncate text-text-muted tr-text-metadata">
					{current?.name ?? "Select model"}
				</span>
				<ChevronDown className="size-3 shrink-0 text-text-muted" />
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
													<span className="truncate text-text-muted tr-text-metadata">
														{subLine(m)}
													</span>
												</span>
												<span className="ml-auto shrink-0 text-text-muted tr-text-metadata">
													{m.id}
												</span>
											</CommandItem>
										);
									})}
							</CommandGroup>
						))}
					</CommandList>
				</Command>
				<button
					type="button"
					data-testid="model-refresh"
					data-refreshing={refreshing}
					disabled={refreshing}
					onClick={() => onRefresh(true)}
					className="flex w-full items-center gap-sm border-border-default border-t px-sm py-xs tr-text-metadata text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-text-muted"
				>
					<RefreshCw className={cn("size-3.5 shrink-0", refreshing && "animate-spin")} />
					{refreshing ? "Updating catalog…" : "Refresh catalog"}
				</button>
			</PopoverContent>
		</Popover>
	);
}
