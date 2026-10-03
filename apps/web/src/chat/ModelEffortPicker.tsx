import {
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiCloudLine as Cloud,
	RiImageLine as Image,
	RiKey2Line as Key,
	RiPushpin2Line as Pin,
	RiQuestionLine as Question,
	RiRefreshLine as RefreshCw,
	type RemixiconComponentType,
	RiSparkling2Line as Sparkles,
	RiStarFill as StarFill,
	RiStarLine as StarLine,
	RiTerminalBoxLine as Terminal,
	RiTicket2Line as Ticket,
} from "@remixicon/react";
import {
	type ProviderAuthKind,
	sameModel,
	type ThinkingLevel,
	type WireModel,
} from "@thinkrail/contracts";
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
	billsPerToken,
	describeAuth,
	describeCost,
	formatContext,
	groupByProvider,
	LEVEL_HINT,
	modelKey,
	trailingLevel,
} from "./modelPicker";
import type { ModelPreferences } from "./useModelPreferences";

const AUTH_ICON: Record<ProviderAuthKind, RemixiconComponentType> = {
	oauth: Ticket,
	"api-key": Key,
	env: Terminal,
	central: Cloud,
	other: Question,
};

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

/** A model choice, carrying a level only when the user picked both at once (`opus high`, or a level on a previewed model). */
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

function ProviderMark({ provider }: { provider: string }) {
	return (
		<span
			aria-hidden
			className="flex size-16 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-control-bg-selected text-text-muted tr-code-text-small uppercase leading-none"
		>
			{provider.slice(0, 1)}
		</span>
	);
}

function AuthGlyph({ model, className }: { model: WireModel; className?: string }) {
	if (!model.auth) return null;
	const Icon = AUTH_ICON[model.auth.kind];
	return <Icon className={cn("size-12 shrink-0", className)} />;
}

function CostMeta({ model }: { model: WireModel }) {
	const cost = describeCost(model);
	return (
		<span className="ml-auto flex shrink-0 items-center gap-8 text-text-muted tr-text-metadata">
			{model.input?.includes("image") ? <Image className="size-12" /> : null}
			<span>{formatContext(model.contextWindow)}</span>
			{cost ? (
				<span className="flex items-center gap-4">
					<AuthGlyph model={model} />
					<span className={cn(billsPerToken(model.auth?.kind) && "tr-code-text-small")}>
						{cost}
					</span>
				</span>
			) : null}
		</span>
	);
}

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

		const pickLevel = (next: ThinkingLevel) => {
			onSelectLevel(next);
			close();
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
					className="group/row"
				>
					<span className="flex w-14 shrink-0 justify-center">
						{isCurrent ? <Check className="size-14 text-primary" /> : null}
					</span>
					<ProviderMark provider={model.provider} />
					<span className="truncate">{model.name}</span>
					<CostMeta model={model} />
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
								"flex size-16 shrink-0 items-center justify-center rounded-[var(--radius-sm)] outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary",
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
		const pillModel = defaultOption?.active ? (defaultOption.model ?? current) : current;
		const pillLevel = defaultOption?.active ? defaultOption.level : level;

		return (
			<Popover open={open} onOpenChange={(next) => (next ? openWith("") : close())}>
				<PopoverTrigger
					data-testid="model-selector"
					data-open={open}
					className={cn(
						"flex h-32 min-w-0 items-center gap-4 rounded-[var(--radius-sm)] border border-control-border-default bg-clip-padding bg-control-bg px-8 tr-text-ui text-text-default outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:border-control-border-active data-[open=true]:bg-control-bg-selected",
						className,
					)}
				>
					{defaultOption?.active ? (
						<Sparkles className="size-12 shrink-0 text-text-muted" />
					) : pillModel ? (
						<ProviderMark provider={pillModel.provider} />
					) : null}
					<span data-testid="model-selector-model" className="truncate">
						{defaultOption?.active ? "Default" : (pillModel?.name ?? "Select model")}
					</span>
					{pillModel ? (
						<>
							<span aria-hidden className="h-14 w-px shrink-0 bg-control-border-active" />
							<span
								data-testid="thinking-selector"
								data-level={pillLevel}
								className="shrink-0 text-text-muted tr-text-metadata capitalize"
							>
								{defaultOption?.active ? `${pillModel.name} · ${pillLevel}` : pillLevel}
							</span>
							{pillModel.auth ? (
								<>
									<span aria-hidden className="h-14 w-px shrink-0 bg-control-border-active" />
									<IconTooltip label={describeAuth(pillModel)} wrapTrigger>
										<AuthGlyph model={pillModel} className="text-text-muted" />
									</IconTooltip>
								</>
							) : null}
						</>
					) : null}
					<ChevronDown className="size-16 shrink-0 text-text-muted" />
				</PopoverTrigger>
				<PopoverContent
					align="start"
					container={container}
					className="w-[min(420px,calc(100vw-16px))] p-0"
				>
					<Command className="bg-transparent">
						<CommandInput
							placeholder="Search models… (append a level: opus high)"
							value={query}
							onValueChange={setQuery}
						/>
						<CommandList className="max-h-[min(320px,50vh)]">
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
									>
										<span className="flex w-14 shrink-0 justify-center">
											{defaultOption.active ? <Check className="size-14 text-primary" /> : null}
										</span>
										<Sparkles className="size-14 shrink-0 text-text-muted" />
										<span className="flex min-w-0 flex-col">
											<span>Default</span>
											<span className="truncate text-text-muted tr-text-metadata">
												{defaultOption.model
													? `Follows Settings → Models · ${defaultOption.model.name} · ${defaultOption.level}`
													: "Follows Settings → Models"}
											</span>
										</span>
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
										className="text-text-muted"
									>
										<ChevronRight className="size-14 shrink-0" />
										<span>All models · {groups.map((g) => g.provider).join(" · ")}</span>
										<span className="ml-auto shrink-0 tr-text-metadata">{models.length}</span>
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
							className="flex flex-col gap-8 border-border-default border-t bg-container-sidebar-bg px-12 py-8"
						>
							<div className="flex items-center gap-4 text-text-muted tr-text-metadata">
								<span>Effort for</span>
								<span className="truncate text-text-default">{current.name}</span>
							</div>
							<fieldset
								aria-label={`Effort for ${current.name}`}
								className="flex gap-2 rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg p-2"
							>
								{effortLevels.map((candidate) => {
									const active = candidate === level;
									const pending = pendingLevel === candidate;
									const isHostDefault = candidate === (preferences.defaultEffort ?? "medium");
									return (
										<button
											key={candidate}
											type="button"
											aria-pressed={active}
											data-testid="thinking-option"
											data-level={candidate}
											onClick={() => pickLevel(candidate)}
											className={cn(
												"flex h-24 min-w-0 flex-1 items-center justify-center gap-2 rounded-[var(--radius-sm)] px-4 tr-text-metadata capitalize outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary",
												active || pending
													? "bg-control-bg-selected text-text-default"
													: "text-text-muted",
												pending && "ring-1 ring-primary",
											)}
										>
											<span className="truncate">{candidate}</span>
											{isHostDefault ? (
												<span aria-hidden className="size-4 shrink-0 rounded-full bg-primary" />
											) : null}
										</button>
									);
								})}
							</fieldset>
							<div className="truncate text-text-subtle tr-text-metadata">
								{LEVEL_HINT[pendingLevel ?? level] ?? "\u00a0"}
							</div>
						</div>
					) : null}
					<div className="flex items-center gap-8 border-border-default border-t px-8 py-4 tr-text-metadata text-text-muted">
						{preferences.supported && current ? (
							<button
								type="button"
								data-testid="model-set-default"
								data-default={isDefaultPair}
								disabled={isDefaultPair}
								onClick={() => preferences.setDefault(current, level)}
								className="flex items-center gap-4 rounded-[var(--radius-sm)] px-4 py-2 outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default disabled:text-text-subtle disabled:hover:bg-transparent"
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
							className="flex items-center gap-4 rounded-[var(--radius-sm)] px-4 py-2 outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-text-muted"
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
