import {
	RiBracesLine as Braces,
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiArrowLeftSLine as ChevronLeft,
	RiArrowRightSLine as ChevronRight,
	RiInfinityLine as InfinityMark,
	RiKey2Line as Key,
	RiPushpin2Line as Pin,
	RiRefreshLine as RefreshCw,
	RiSparkling2Line as Sparkles,
	RiStarFill as StarFill,
	RiStarLine as StarLine,
} from "@remixicon/react";
import { sameModel, type ThinkingLevel, type WireModel } from "@thinkrail/contracts";
import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IconTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib";
import {
	costLabel,
	describeAuth,
	EFFORT_BARS,
	formatContext,
	groupByProvider,
	kindLabel,
	LEVEL_HINT,
	litBars,
	modelKey,
	trailingLevel,
} from "./modelPicker";
import { ProviderGlyph } from "./ProviderGlyph";
import type { ModelPreferences } from "./useModelPreferences";

export interface ModelEffortPickerHandle {
	/** Opens the popover with the search prefilled — the `/model` slash command's entry. */
	open: (query?: string) => void;
}

/** The pre-session "Default" row: what the host would pick when the caller sends no explicit pair. */
export interface DefaultPairOption {
	model: WireModel | null;
	level: ThinkingLevel;
	/** True while the held pair is the default rather than an explicit choice. */
	active: boolean;
	onSelect: () => void;
}

/** A model choice, carrying a level only when the user picked both at once (`opus high`). */
export interface ModelSelection {
	model: WireModel;
	level?: ThinkingLevel;
}

export interface ModelEffortPickerProps {
	models: WireModel[];
	current: WireModel | null;
	level: ThinkingLevel;
	onSelect: (selection: ModelSelection) => void;
	/** A level change for the current model alone. */
	onSelectLevel: (level: ThinkingLevel) => void;
	refreshing: boolean;
	onRefresh: (force: boolean) => void;
	preferences: ModelPreferences;
	defaultOption?: DefaultPairOption;
	container?: HTMLElement | null;
	className?: string;
}

/** The connection-kind mark: key = API key, ∞ = subscription, { } = environment key, JCP = JetBrains AI. */
function KindGlyph({ model, className }: { model: WireModel; className?: string }) {
	switch (model.auth?.kind) {
		case "api-key":
			return <Key className={cn("size-12 shrink-0", className)} />;
		case "oauth":
			return <InfinityMark className={cn("size-12 shrink-0", className)} />;
		case "env":
			return <Braces className={cn("size-12 shrink-0", className)} />;
		case "central":
			return (
				<span
					className={cn(
						"inline-flex h-14 shrink-0 items-center rounded-[var(--radius-sm)] border border-control-border-active px-2 tr-code-text-small leading-none",
						className,
					)}
				>
					JCP
				</span>
			);
		default:
			return null;
	}
}

function EffortBars({
	level,
	levels,
	className,
}: {
	level: ThinkingLevel;
	levels: readonly ThinkingLevel[];
	className?: string;
}) {
	const lit = litBars(level, levels);
	return (
		<span aria-hidden className={cn("inline-flex h-12 shrink-0 items-end gap-2", className)}>
			{Array.from({ length: EFFORT_BARS }, (_, index) => (
				<span
					key={index}
					className={cn(
						"w-2 rounded-[var(--radius-xs)] bg-current",
						index >= lit && "opacity-30",
						index === 0 && "h-4",
						index === 1 && "h-6",
						index === 2 && "h-8",
						index === 3 && "h-12",
					)}
				/>
			))}
		</span>
	);
}

function RowMeta({ model, withProvider }: { model: WireModel; withProvider: boolean }) {
	const kind = kindLabel(model);
	const cost = costLabel(model);
	return (
		<span className="flex min-w-0 items-center gap-4 truncate text-text-muted tr-text-metadata">
			{withProvider ? <span className="shrink-0">{model.provider}</span> : null}
			{kind ? (
				<>
					{withProvider ? <span aria-hidden>·</span> : null}
					<KindGlyph model={model} />
					<span className="truncate">{kind}</span>
				</>
			) : null}
			{cost ? (
				<>
					{withProvider || kind ? <span aria-hidden>·</span> : null}
					<span className="shrink-0">{cost} per M</span>
				</>
			) : null}
			{withProvider || kind || cost ? <span aria-hidden>·</span> : null}
			<span className="shrink-0">{formatContext(model.contextWindow)}</span>
		</span>
	);
}

const FOOTER_LINK =
	"flex items-center gap-4 rounded-[var(--radius-sm)] px-4 py-2 tr-text-metadata text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default disabled:text-text-subtle disabled:hover:bg-transparent";

const STEP_BUTTON =
	"flex size-24 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-control-border-default text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary disabled:border-control-disabled-border disabled:text-control-disabled-text disabled:hover:bg-transparent";

export const ModelEffortPicker = forwardRef<ModelEffortPickerHandle, ModelEffortPickerProps>(
	function ModelEffortPicker(
		{
			models,
			current,
			level,
			onSelect,
			onSelectLevel,
			refreshing,
			onRefresh,
			preferences,
			defaultOption,
			container,
			className,
		},
		handleRef,
	) {
		const [open, setOpen] = useState(false);
		const [query, setQuery] = useState("");
		const [showAll, setShowAll] = useState(false);

		const openWith = (next: string) => {
			setQuery(next);
			setOpen(true);
			onRefresh(false);
		};

		useImperativeHandle(handleRef, () => ({ open: (q = "") => openWith(q) }));

		const close = () => {
			setOpen(false);
			setQuery("");
			setShowAll(false);
		};

		const groups = useMemo(() => groupByProvider(models), [models]);
		const shortlist = preferences.favorites.length > 0 || preferences.recents.length > 0;
		const folded = shortlist && !showAll && query.trim() === "";
		const pendingLevel = trailingLevel(query, current);

		const pickModel = (model: WireModel) => {
			const typedLevel = trailingLevel(query, model);
			if (typedLevel) {
				onSelect({ model, level: typedLevel });
				close();
				return;
			}
			if (sameModel(model, current) && !defaultOption?.active) {
				close();
				return;
			}
			onSelect({ model });
			setQuery("");
		};

		const renderModel = (model: WireModel, section: string) => {
			const favorite = preferences.isFavorite(model);
			const isCurrent = !defaultOption?.active && sameModel(model, current);
			return (
				<CommandItem
					key={`${section}:${modelKey(model)}`}
					value={`${section}:${modelKey(model)}`}
					keywords={[model.name, model.id, model.provider, ...model.thinkingLevels]}
					data-testid="model-option"
					data-model-id={model.id}
					data-provider={model.provider}
					title={describeAuth(model) ?? undefined}
					onSelect={() => pickModel(model)}
					className={cn(
						"group/row items-start gap-8 py-4",
						isCurrent && "bg-primary-subtle data-[selected=true]:bg-primary-subtle",
					)}
				>
					<ProviderGlyph provider={model.provider} className="mt-2 text-text-muted" />
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="truncate">{model.name}</span>
						<RowMeta model={model} withProvider={section !== "all"} />
					</span>
					{isCurrent ? <Check className="mt-2 size-14 shrink-0 text-primary" /> : null}
					{preferences.supported ? (
						<button
							type="button"
							data-testid="model-favorite-toggle"
							data-favorite={favorite}
							aria-label={favorite ? `Unstar ${model.name}` : `Star ${model.name}`}
							aria-pressed={favorite}
							onClick={(event) => {
								event.stopPropagation();
								preferences.toggleFavorite(model);
							}}
							className={cn(
								"mt-2 flex size-16 shrink-0 items-center justify-center rounded-[var(--radius-sm)] outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary",
								favorite
									? "text-feedback-warning"
									: "text-text-subtle opacity-0 group-hover/row:opacity-100 group-data-[selected=true]/row:opacity-100 focus-visible:opacity-100",
							)}
						>
							{favorite ? <StarFill className="size-12" /> : <StarLine className="size-12" />}
						</button>
					) : null}
				</CommandItem>
			);
		};

		const effortLevels = current?.thinkingLevels ?? [];
		const levelIndex = effortLevels.indexOf(level);
		const isDefaultPair = current !== null && preferences.isDefault(current, level);
		const pillModel = defaultOption?.active ? (defaultOption.model ?? current) : current;
		const pillLevel = defaultOption?.active ? defaultOption.level : level;
		const hint = LEVEL_HINT[pendingLevel ?? level];

		return (
			<Popover open={open} onOpenChange={(next) => (next ? openWith("") : close())}>
				<PopoverTrigger
					data-testid="model-selector"
					data-open={open}
					className={cn(
						"flex h-32 min-w-0 items-center gap-8 rounded-[var(--radius-sm)] px-8 tr-text-ui text-text-default outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:bg-control-bg-selected",
						className,
					)}
				>
					{defaultOption?.active ? (
						<Sparkles className="size-14 shrink-0 text-text-muted" />
					) : pillModel ? (
						<ProviderGlyph provider={pillModel.provider} className="size-14 text-text-muted" />
					) : null}
					<span data-testid="model-selector-model" className="truncate">
						{defaultOption?.active ? "Default" : (pillModel?.name ?? "Select model")}
					</span>
					{pillModel ? (
						<>
							{defaultOption?.active ? (
								<span className="truncate text-text-muted tr-text-metadata">{pillModel.name}</span>
							) : null}
							<span
								data-testid="thinking-selector"
								data-level={pillLevel}
								className="flex shrink-0 items-center gap-4 text-text-muted tr-text-metadata capitalize"
							>
								<EffortBars
									level={pillLevel}
									levels={pillModel.thinkingLevels}
									className="text-primary"
								/>
								{pillLevel}
							</span>
							{pillModel.auth ? (
								<IconTooltip label={describeAuth(pillModel)} wrapTrigger>
									<KindGlyph model={pillModel} className="text-text-muted" />
								</IconTooltip>
							) : null}
						</>
					) : null}
					<ChevronDown className="size-14 shrink-0 text-text-muted" />
				</PopoverTrigger>
				<PopoverContent
					align="start"
					container={container}
					className="w-[min(360px,calc(100vw-16px))] p-0"
				>
					<Command className="bg-transparent">
						<CommandInput
							placeholder="Search models… (append a level: opus high)"
							value={query}
							onValueChange={setQuery}
						/>
						<CommandList className="max-h-[min(340px,50vh)]">
							<CommandEmpty>No models found.</CommandEmpty>
							{defaultOption ? (
								<CommandGroup>
									<CommandItem
										value="default:pair"
										keywords={["default"]}
										data-testid="model-option-default"
										onSelect={() => {
											defaultOption.onSelect();
											close();
										}}
										className={cn(
											"items-start gap-8 py-4",
											defaultOption.active &&
												"bg-primary-subtle data-[selected=true]:bg-primary-subtle",
										)}
									>
										<Sparkles className="mt-2 size-16 shrink-0 text-text-muted" />
										<span className="flex min-w-0 flex-1 flex-col">
											<span>Default</span>
											<span className="truncate text-text-muted tr-text-metadata">
												{defaultOption.model
													? `Follows Settings → Models · ${defaultOption.model.name} · ${defaultOption.level}`
													: "Follows Settings → Models"}
											</span>
										</span>
										{defaultOption.active ? (
											<Check className="mt-2 size-14 shrink-0 text-primary" />
										) : null}
									</CommandItem>
								</CommandGroup>
							) : null}
							{preferences.favorites.length > 0 ? (
								<CommandGroup heading="Favorites">
									{preferences.favorites.map((m) => renderModel(m, "fav"))}
								</CommandGroup>
							) : null}
							{preferences.recents.length > 0 ? (
								<CommandGroup heading="Recent">
									{preferences.recents.slice(0, 3).map((m) => renderModel(m, "recent"))}
								</CommandGroup>
							) : null}
							{folded ? (
								<CommandGroup>
									<CommandItem
										value="all:models"
										data-testid="model-show-all"
										onSelect={() => setShowAll(true)}
										className="items-start gap-8 py-4 text-text-muted"
									>
										<ChevronRight className="mt-2 size-16 shrink-0" />
										<span className="flex min-w-0 flex-1 flex-col">
											<span>All models</span>
											<span className="truncate tr-text-metadata">
												{groups.map((g) => g.provider).join(" · ")} · {models.length}
											</span>
										</span>
									</CommandItem>
								</CommandGroup>
							) : (
								groups.map((group) => (
									<CommandGroup
										key={group.provider}
										heading={
											<span className="flex items-center gap-8">
												<span className="truncate">{group.provider}</span>
												{group.auth ? (
													<span className="ml-auto truncate text-text-subtle">{group.auth}</span>
												) : null}
											</span>
										}
									>
										{group.models.map((m) => renderModel(m, "all"))}
									</CommandGroup>
								))
							)}
						</CommandList>
					</Command>
					{current && effortLevels.length > 0 ? (
						<div
							data-testid="thinking-section"
							className="flex flex-col gap-4 border-border-default border-t px-8 py-8"
						>
							<div className="flex items-center gap-4 px-4 text-text-muted tr-text-metadata">
								<span>Effort</span>
								<span aria-hidden>·</span>
								<span className="truncate">{current.name}</span>
							</div>
							<div className="flex items-center gap-8">
								<button
									type="button"
									data-testid="thinking-step-prev"
									aria-label="Lower effort"
									disabled={levelIndex <= 0}
									onClick={() => {
										const previous = effortLevels[levelIndex - 1];
										if (previous) onSelectLevel(previous);
									}}
									className={STEP_BUTTON}
								>
									<ChevronLeft className="size-14" />
								</button>
								<div className="flex min-w-0 flex-1 flex-col items-center gap-2">
									<span className="flex items-center gap-8 tr-text-ui text-text-default capitalize">
										<EffortBars level={level} levels={effortLevels} className="text-primary" />
										{level}
									</span>
									<span className="truncate text-text-subtle tr-text-metadata">
										{hint ?? "\u00a0"}
									</span>
									<span className="flex items-center gap-2">
										{effortLevels.map((candidate) => {
											const active = candidate === level;
											const isHostDefault = candidate === (preferences.defaultEffort ?? "medium");
											return (
												<button
													key={candidate}
													type="button"
													data-testid="thinking-option"
													data-level={candidate}
													aria-label={`${candidate} effort`}
													aria-pressed={active}
													onClick={() => onSelectLevel(candidate)}
													className="flex size-16 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary"
												>
													<span
														className={cn(
															"size-6 rounded-full",
															active ? "bg-primary" : "bg-control-border-active",
															isHostDefault && !active && "ring-1 ring-primary-muted",
															pendingLevel === candidate && "ring-1 ring-primary",
														)}
													/>
												</button>
											);
										})}
									</span>
								</div>
								<button
									type="button"
									data-testid="thinking-step-next"
									aria-label="Raise effort"
									disabled={levelIndex < 0 || levelIndex >= effortLevels.length - 1}
									onClick={() => {
										const next = effortLevels[levelIndex + 1];
										if (next) onSelectLevel(next);
									}}
									className={STEP_BUTTON}
								>
									<ChevronRight className="size-14" />
								</button>
							</div>
						</div>
					) : null}
					<div className="flex items-center gap-8 border-border-default border-t px-8 py-4">
						{preferences.supported && current ? (
							<button
								type="button"
								data-testid="model-set-default"
								data-default={isDefaultPair}
								disabled={isDefaultPair}
								onClick={() => preferences.setDefault(current, level)}
								className={FOOTER_LINK}
							>
								{isDefaultPair ? (
									<Check className="size-12 shrink-0 text-primary" />
								) : (
									<Pin className="size-12 shrink-0" />
								)}
								{isDefaultPair ? "Default for new chats" : "Set as default"}
							</button>
						) : null}
						<span className="flex-1" />
						<button
							type="button"
							data-testid="model-refresh"
							data-refreshing={refreshing}
							disabled={refreshing}
							onClick={() => onRefresh(true)}
							className={FOOTER_LINK}
						>
							<RefreshCw className={cn("size-12 shrink-0", refreshing && "animate-spin")} />
							{refreshing ? "Updating…" : "Refresh"}
						</button>
					</div>
				</PopoverContent>
			</Popover>
		);
	},
);
