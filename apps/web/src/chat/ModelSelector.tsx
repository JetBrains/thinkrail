import {
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiPushpin2Line as Pin,
	RiRefreshLine as RefreshCw,
	RiStarFill as StarFill,
	RiStarLine as StarLine,
} from "@remixicon/react";
import { sameModel, type WireModel } from "@thinkrail/contracts";
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
import { useMemo, useState } from "react";
import { formatContext, groupByProvider, modelKey } from "./modelPicker";
import { ProviderGlyph } from "./ProviderGlyph";
import type { ModelPreferences } from "./useModelPreferences";

function subLine(model: WireModel): string {
	const parts = [`${formatContext(model.contextWindow)} context`];
	if (model.reasoning) parts.push("reasoning");
	return parts.join(" · ");
}

export function ModelSelector({
	models,
	current,
	onSelect,
	refreshing,
	onRefresh,
	container,
	className,
	placeholder,
	defaultOption,
	onSelectDefault,
	disabled = false,
	preferences,
}: {
	models: WireModel[];
	current: WireModel | null;
	onSelect: (model: WireModel) => void;
	refreshing: boolean;
	onRefresh: (force: boolean) => void;
	container?: HTMLElement | null;
	className?: string;
	placeholder?: string;
	defaultOption?: string;
	onSelectDefault?: () => void;
	disabled?: boolean;
	/** Optional model preferences for pinned/favorites support. */
	preferences?: ModelPreferences;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());

	const groups = useMemo(() => groupByProvider(models), [models]);
	const pinnedModels = preferences?.favorites ?? [];
	const pinnedKeys = useMemo(() => new Set(pinnedModels.map(modelKey)), [pinnedModels]);
	const isSearching = query.trim() !== "";

	const select = (model: WireModel) => {
		onSelect(model);
		setOpen(false);
		setQuery("");
	};

	const toggleProvider = (provider: string) => {
		setExpandedProviders((prev) => {
			const next = new Set(prev);
			if (next.has(provider)) next.delete(provider);
			else next.add(provider);
			return next;
		});
	};

	const renderModel = (model: WireModel, section: string) => {
		const isCurrent = sameModel(current, model);
		const isPinned = pinnedKeys.has(modelKey(model));
		return (
			<CommandItem
				key={`${section}:${modelKey(model)}`}
				value={`${section}:${modelKey(model)}`}
				keywords={[model.name, model.id, model.provider]}
				data-testid="model-option"
				data-model-id={model.id}
				data-provider={model.provider}
				onSelect={() => select(model)}
				className={cn(
					"group/row items-start gap-8 py-4",
					isCurrent && "bg-primary-subtle data-[selected=true]:bg-primary-subtle",
				)}
			>
				<ProviderGlyph provider={model.provider} className="mt-2 text-text-muted" />
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="truncate">{model.name}</span>
					<span className="truncate text-text-muted tr-text-metadata">{subLine(model)}</span>
				</span>
				<span className="mt-2 shrink-0 text-text-subtle tr-text-metadata">{model.id}</span>
				{isCurrent ? <Check className="mt-2 size-14 shrink-0 text-primary" /> : null}
				{preferences?.supported ? (
					<button
						type="button"
						data-testid="model-favorite-toggle"
						data-favorite={isPinned}
						aria-label={isPinned ? `Unpin ${model.name}` : `Pin ${model.name}`}
						aria-pressed={isPinned}
						onClick={(event) => {
							event.stopPropagation();
							preferences.toggleFavorite(model);
						}}
						className={cn(
							"mt-2 flex size-16 shrink-0 items-center justify-center rounded-sm outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary",
							isPinned
								? "text-feedback-warning"
								: "text-text-subtle opacity-0 group-hover/row:opacity-100 group-data-[selected=true]/row:opacity-100 focus-visible:opacity-100",
						)}
					>
						{isPinned ? <StarFill className="size-12" /> : <StarLine className="size-12" />}
					</button>
				) : null}
			</CommandItem>
		);
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) {
					onRefresh(false);
					setQuery("");
					setExpandedProviders(new Set());
				}
			}}
		>
			<PopoverTrigger
				data-testid="model-selector"
				data-open={open}
				disabled={disabled}
				className={cn(
					"flex h-32 max-w-[220px] items-center gap-8 rounded-sm border border-control-border-default bg-clip-padding bg-control-bg px-8 tr-text-ui text-text-default outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:border-control-border-active data-[open=true]:bg-control-bg-selected",
					className,
				)}
			>
				<span className="truncate text-text-muted tr-text-metadata">
					{current?.name ?? (placeholder || "Select model")}
				</span>
				<ChevronDown className="size-16 shrink-0 text-text-muted" />
			</PopoverTrigger>
			<PopoverContent align="start" container={container} className="w-[340px] p-0">
				<Command className="min-h-0 flex-1 bg-transparent">
					<CommandInput placeholder="Search models…" value={query} onValueChange={setQuery} />
					<CommandList className="max-h-[340px] min-h-0 flex-1 pb-[2.5rem]">
						<CommandEmpty>No models found.</CommandEmpty>

						{/* Default option */}
						{defaultOption !== undefined && onSelectDefault !== undefined && (
							<CommandGroup>
								<CommandItem
									value={`default:${defaultOption}`}
									keywords={["default"]}
									data-testid="model-option-default"
									onSelect={() => {
										onSelectDefault();
										setOpen(false);
										setQuery("");
									}}
									className={cn(
										"items-start gap-8 py-4",
										current === null && "bg-primary-subtle data-[selected=true]:bg-primary-subtle",
									)}
								>
									<Pin className="mt-2 size-16 shrink-0 text-text-muted" />
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="truncate">{defaultOption}</span>
									</span>
									{current === null ? (
										<Check className="mt-2 size-14 shrink-0 text-primary" />
									) : null}
								</CommandItem>
							</CommandGroup>
						)}

						{/* Pinned models */}
						{pinnedModels.length > 0 && (
							<CommandGroup heading="Pinned">
								{pinnedModels.map((m) => renderModel(m, "pinned"))}
							</CommandGroup>
						)}

						{/* Provider groups - collapsed by default, auto-expand when searching */}
						{groups.map((group) => {
							const isExpanded = expandedProviders.has(group.provider) || isSearching;
							// Filter out pinned models from provider groups to avoid duplicates
							const unpinnedModels = group.models.filter((m) => !pinnedKeys.has(modelKey(m)));
							if (unpinnedModels.length === 0) return null;

							return (
								<div key={group.provider}>
									{/* Collapsible provider header */}
									<button
										type="button"
										onClick={() => toggleProvider(group.provider)}
										className="flex w-full items-center gap-8 px-8 py-8 text-left outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
									>
										<ProviderGlyph provider={group.provider} className="size-14 shrink-0" />
										<span className="flex-1 truncate tr-text-ui text-text-default">
											{group.provider}
										</span>
										<span className="tr-text-metadata text-text-muted">
											{unpinnedModels.length}
										</span>
										{isExpanded ? (
											<ChevronDown className="size-14 shrink-0 text-text-muted" />
										) : (
											<ChevronRight className="size-14 shrink-0 text-text-muted" />
										)}
									</button>
									{/* Models in this provider */}
									{isExpanded && (
										<CommandGroup>{unpinnedModels.map((m) => renderModel(m, "all"))}</CommandGroup>
									)}
								</div>
							);
						})}
					</CommandList>
				</Command>

				{/* Footer with gradient fade and compact refresh button */}
				<div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-end bg-[linear-gradient(to_top,var(--container-elevated-bg),transparent)] px-8 pt-24 pb-8">
					<button
						type="button"
						data-testid="model-refresh"
						data-refreshing={refreshing}
						disabled={refreshing}
						onClick={() => onRefresh(true)}
						className="pointer-events-auto inline-flex items-center gap-4 rounded-sm border border-control-border-default bg-control-bg px-8 py-4 tr-text-metadata text-text-default shadow-sm outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default disabled:text-text-muted disabled:hover:bg-control-bg"
					>
						<RefreshCw className={cn("size-12 shrink-0", refreshing && "animate-spin")} />
						{refreshing ? "Updating…" : "Refresh"}
					</button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
