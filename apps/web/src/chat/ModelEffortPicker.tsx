import {
	RiBracesLine as Braces,
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiFireLine as Fire,
	RiFlashlightLine as Flash,
	RiContrastDrop2Line as HalfDrop,
	RiInfinityLine as InfinityMark,
	RiKey2Line as Key,
	RiLeafLine as Leaf,
	RiPushpin2Line as Pin,
	RiRefreshLine as RefreshCw,
	type RemixiconComponentType,
	RiSparklingLine as Sparkle,
	RiSparkling2Line as Sparkles,
	RiStarFill as StarFill,
	RiStarLine as StarLine,
	RiZzzLine as Zzz,
} from "@remixicon/react";
import {
	type ModelDefault,
	sameModel,
	type ThinkingLevel,
	type WireModel,
} from "@thinkrail/contracts";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@thinkrail/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { type CSSProperties, forwardRef, useImperativeHandle, useMemo, useState } from "react";
import {
	CENTRAL_KIND_TAG,
	COSTLY_LEVELS,
	costLabel,
	describeAuth,
	EFFORT_BAR_HEIGHTS,
	formatContext,
	groupByProvider,
	kindLabel,
	LEVEL_HINT,
	type LevelTone,
	levelPosition,
	levelTone,
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
	/** The host's `model.default` answer, or `null` while it is still being asked. */
	resolved: ModelDefault | null;
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

function hasKindGlyph(model: WireModel): boolean {
	return model.auth !== undefined && model.auth.kind !== "other";
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
						"inline-flex h-14 shrink-0 items-center rounded-sm border border-control-border-active px-2 tr-code-text-small leading-none",
						className,
					)}
				>
					{CENTRAL_KIND_TAG}
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
			{EFFORT_BAR_HEIGHTS.map((height, index) => (
				<span
					key={height}
					className={cn("w-2 rounded-xs bg-current", height, index >= lit && "opacity-30")}
				/>
			))}
		</span>
	);
}

const TONE_TEXT: Record<LevelTone, string> = {
	cool: "text-feedback-info",
	accent: "text-primary",
	hot: "text-feedback-warning",
};

/**
 * The rail between two adjacent levels: solid within a tone, a blend where the tone changes. Tones
 * only ever warm up along a model's levels, so the cooling pairs just stay solid.
 */
const TONE_SEGMENT: Record<`${LevelTone}>${LevelTone}`, string> = {
	"cool>cool": "bg-feedback-info",
	"cool>accent": "bg-[linear-gradient(90deg,var(--feedback-info),var(--primary))]",
	"cool>hot": "bg-[linear-gradient(90deg,var(--feedback-info),var(--feedback-warning))]",
	"accent>cool": "bg-primary",
	"accent>accent": "bg-primary",
	"accent>hot": "bg-[linear-gradient(90deg,var(--primary),var(--feedback-warning))]",
	"hot>cool": "bg-feedback-warning",
	"hot>accent": "bg-feedback-warning",
	"hot>hot": "bg-feedback-warning",
};

const LEVEL_GLYPH: Record<ThinkingLevel, RemixiconComponentType> = {
	off: Zzz,
	minimal: Leaf,
	low: Flash,
	medium: HalfDrop,
	high: Sparkles,
	xhigh: Sparkle,
	max: Fire,
};

/**
 * The effort slider: a thick rail hiding a cool→warm gradient that the handle uncovers as it moves,
 * with the level word riding on the handle. A native range input does the dragging, keyboard and
 * touch; the labels beneath are the same levels as buttons.
 */
function EffortSlider({
	model,
	level,
	defaultLevel,
	onSelectLevel,
}: {
	model: WireModel;
	level: ThinkingLevel;
	defaultLevel: ThinkingLevel | undefined;
	onSelectLevel: (level: ThinkingLevel) => void;
}) {
	const levels = model.thinkingLevels;
	const index = levels.indexOf(level);
	const Glyph = LEVEL_GLYPH[level];
	return (
		<div
			data-testid="thinking-section"
			className="flex shrink-0 flex-col gap-4 border-border-default border-t px-12 pt-8 pb-4"
		>
			<div className="flex items-center gap-4 text-text-muted tr-text-metadata">
				<span>Effort</span>
				<span aria-hidden>·</span>
				<span className="truncate">{model.name}</span>
			</div>
			<div
				className="relative h-32"
				style={{ "--effort": `${levelPosition(level, levels)}%` } as CSSProperties}
			>
				<div
					aria-hidden
					className="pointer-events-none absolute inset-x-0 top-8 h-14 overflow-hidden rounded-full border border-control-border-default bg-control-bg"
				>
					<div className="absolute inset-0 flex transition-[clip-path] duration-500 ease-[cubic-bezier(0.34,1.3,0.64,1)] [clip-path:inset(0_calc(100%-var(--effort))_0_0_round_999px)] motion-reduce:transition-none">
						{levels.map((next, i) => {
							const from = levels[i - 1];
							return from ? (
								<span
									key={next}
									className={cn("flex-1", TONE_SEGMENT[`${levelTone(from)}>${levelTone(next)}`])}
								/>
							) : null;
						})}
					</div>
				</div>
				<input
					type="range"
					min={0}
					max={levels.length - 1}
					step={1}
					value={Math.max(0, index)}
					aria-label={`Effort for ${model.name}`}
					aria-valuetext={level}
					data-testid="thinking-slider"
					onChange={(event) => {
						const next = levels[Number(event.target.value)];
						if (next && next !== level) onSelectLevel(next);
					}}
					className="peer absolute inset-0 m-0 size-full cursor-pointer opacity-0"
				/>
				<div
					aria-hidden
					className="pointer-events-none absolute top-2 left-[clamp(32px,var(--effort),calc(100%-32px))] flex h-24 min-w-64 -translate-x-1/2 items-center justify-center gap-4 rounded-full border border-control-border-active bg-container-elevated-bg px-8 text-text-default tr-text-label-pill capitalize shadow-[var(--shadow-sm)] transition-[left] duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] peer-focus-visible:ring-2 peer-focus-visible:ring-primary motion-reduce:transition-none"
				>
					<Glyph className={cn("size-12 shrink-0", TONE_TEXT[levelTone(level)])} />
					{level}
				</div>
			</div>
			<div className="flex justify-between px-2">
				{levels.map((candidate, i) => {
					const active = candidate === level;
					return (
						<span
							key={candidate}
							className={cn(
								"flex w-0",
								i === 0
									? "justify-start"
									: i === levels.length - 1
										? "justify-end"
										: "justify-center",
							)}
						>
							<button
								type="button"
								data-testid="thinking-option"
								data-level={candidate}
								aria-pressed={active}
								onClick={() => onSelectLevel(candidate)}
								className={cn(
									"relative rounded-sm px-4 py-2 tr-text-metadata capitalize outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
									active ? "text-text-default" : "text-text-subtle hover:text-text-muted",
								)}
							>
								{candidate}
								{candidate === defaultLevel ? (
									<span
										aria-hidden
										className="-bottom-2 -translate-x-1/2 absolute left-1/2 size-4 rounded-full bg-primary-muted"
									/>
								) : null}
							</button>
						</span>
					);
				})}
			</div>
			<div className="flex items-center gap-8 text-text-subtle tr-text-metadata">
				<span className="truncate">{LEVEL_HINT[level]}</span>
				{COSTLY_LEVELS.has(level) ? (
					<span className="flex shrink-0 items-center gap-4 text-feedback-warning">
						<Flash className="size-12" />
						uses your limits faster
					</span>
				) : null}
			</div>
		</div>
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
	"flex items-center gap-4 rounded-sm px-4 py-2 tr-text-metadata text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default disabled:text-text-subtle disabled:hover:bg-transparent";

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
								"mt-2 flex size-16 shrink-0 items-center justify-center rounded-sm outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary",
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
		const isDefaultPair = current !== null && preferences.isDefault(current, level);
		const resetLevel =
			preferences.defaultEffort !== undefined &&
			preferences.defaultEffort !== level &&
			effortLevels.includes(preferences.defaultEffort)
				? preferences.defaultEffort
				: null;
		const following = defaultOption?.active ? defaultOption.resolved : null;
		const pillModel = defaultOption?.active ? (following?.model ?? null) : current;
		const pillLevel = following?.thinkingLevel ?? level;

		return (
			<Popover open={open} onOpenChange={(next) => (next ? openWith("") : close())}>
				<PopoverTrigger
					data-testid="model-selector"
					data-open={open}
					className={cn(
						"flex h-32 min-w-0 items-center gap-8 rounded-sm px-8 tr-text-ui text-text-default outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:bg-control-bg-selected",
						className,
					)}
				>
					{defaultOption?.active ? (
						<Sparkles className="size-14 shrink-0 text-text-muted" />
					) : pillModel ? (
						<ProviderGlyph provider={pillModel.provider} className="size-14 text-text-muted" />
					) : null}
					<span className="truncate">
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
									className={TONE_TEXT[levelTone(pillLevel)]}
								/>
								{pillLevel}
							</span>
							{hasKindGlyph(pillModel) ? (
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
					className="flex max-h-[var(--radix-popover-content-available-height)] w-[min(360px,calc(100vw-16px))] flex-col p-0"
				>
					<Command className="min-h-0 flex-1 bg-transparent">
						<CommandInput
							placeholder="Search models… (append a level: opus high)"
							value={query}
							onValueChange={setQuery}
						/>
						<CommandList className="max-h-[340px] min-h-0 flex-1">
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
												{defaultOption.resolved?.model
													? `Follows Settings → Models · ${defaultOption.resolved.model.name} · ${defaultOption.resolved.thinkingLevel}`
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
									{preferences.recents.map((m) => renderModel(m, "recent"))}
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
						<EffortSlider
							model={current}
							level={level}
							defaultLevel={preferences.defaultEffort}
							onSelectLevel={onSelectLevel}
						/>
					) : null}
					<div className="flex shrink-0 items-center gap-8 border-border-default border-t px-8 py-4">
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
						{resetLevel ? (
							<button
								type="button"
								data-testid="thinking-reset"
								onClick={() => onSelectLevel(resetLevel)}
								className={FOOTER_LINK}
							>
								<RefreshCw className="size-12 shrink-0" />
								reset to {resetLevel}
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
