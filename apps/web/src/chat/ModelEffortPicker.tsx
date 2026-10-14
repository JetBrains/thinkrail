import {
	RiBracesLine as Braces,
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiInfinityLine as InfinityMark,
	RiKey2Line as Key,
	RiPushpinLine as PinLine,
	RiRefreshLine as RefreshCw,
	RiRadioButtonFill,
	RiRadioButtonLine,
	RiSparkling2Line as Sparkles,
	RiUnpinLine as UnpinLine,
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
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import {
	CENTRAL_KIND_TAG,
	costLabel,
	describeAuth,
	formatContext,
	kindLabel,
	modelKey,
	type ProviderGroup,
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

/** Compact UI labels for effort levels. */
const EFFORT_LABELS: Partial<Record<ThinkingLevel, string>> = {
	off: "Off",
	minimal: "Min",
	low: "Low",
	medium: "Med",
	high: "High",
	xhigh: "XHigh",
	max: "Max",
};

/** Get compact label for an effort level, with fallback for unknown levels. */
export function effortLabel(level: ThinkingLevel): string {
	return EFFORT_LABELS[level] ?? level.charAt(0).toUpperCase() + level.slice(1);
}

/** Map effort level to number of filled bars (1-4). */
function effortBarCount(level: ThinkingLevel): number {
	switch (level) {
		case "off":
		case "minimal":
			return 1;
		case "low":
			return 2;
		case "medium":
			return 3;
		case "high":
		case "xhigh":
		case "max":
			return 4;
	}
}

/** Four-bar effort indicator. Filled bars use text color; High uses green for all bars. */
function EffortBars({ level, className }: { level: ThinkingLevel; className?: string }) {
	const filledCount = effortBarCount(level);
	const isHigh = level === "high" || level === "xhigh" || level === "max";
	const filledColor = isHigh ? "bg-feedback-success" : "bg-current";

	return (
		<span aria-hidden className={cn("inline-flex h-10 shrink-0 items-end gap-2", className)}>
			{[0, 1, 2, 3].map((i) => (
				<span
					key={i}
					className={cn(
						"h-full w-3 rounded-xs",
						i < filledCount ? filledColor : "bg-text-subtle opacity-30",
					)}
				/>
			))}
		</span>
	);
}

/** Compact effort indicator for the collapsed model pill with tooltip. */
function EffortIndicator({ level }: { level: ThinkingLevel }) {
	const isHigh = level === "high" || level === "xhigh" || level === "max";

	return (
		<IconTooltip label={`Effort: ${effortLabel(level)}`}>
			<span
				data-testid="effort-indicator"
				data-level={level}
				className={cn(
					"flex shrink-0 items-center",
					isHigh ? "text-feedback-success" : "text-text-default",
				)}
			>
				<EffortBars level={level} />
			</span>
		</IconTooltip>
	);
}

/** Effort level descriptions shown next to the heading. */
const EFFORT_DESCRIPTIONS: Partial<Record<ThinkingLevel, string>> = {
	off: "No reasoning · Fastest · Cheapest",
	minimal: "Briefest reasoning",
	low: "Light reasoning",
	medium: "Balanced reasoning",
	high: "Deep reasoning",
	xhigh: "Extended reasoning",
	max: "Maximum reasoning",
};

/** Get description for an effort level, with fallback for unknown levels. */
export function effortDescription(level: ThinkingLevel): string {
	return EFFORT_DESCRIPTIONS[level] ?? `${effortLabel(level)} reasoning`;
}

/** The effort segmented control with label on its own line and switcher below. */
function EffortSegmentedControl({
	level,
	levels,
	onSelectLevel,
}: {
	level: ThinkingLevel;
	levels: readonly ThinkingLevel[];
	onSelectLevel: (level: ThinkingLevel) => void;
}) {
	const description = effortDescription(level);

	return (
		<div
			data-testid="thinking-section"
			className="flex shrink-0 flex-col gap-12 border-border-default border-t px-12 pt-12 pb-12"
		>
			<div className="flex items-center justify-between">
				<span className="tr-text-eyebrow text-text-subtle">EFFORT</span>
				<span className="tr-text-metadata text-text-subtle">{description}</span>
			</div>
			<div className="flex w-full items-center rounded-sm border border-border-muted p-2">
				{levels.map((candidate) => {
					const active = candidate === level;
					return (
						<button
							key={candidate}
							type="button"
							aria-pressed={active}
							data-testid="thinking-option"
							data-level={candidate}
							onClick={() => onSelectLevel(candidate)}
							className={cn(
								"flex-1 rounded-sm px-4 py-2 text-center tr-text-metadata outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
								active
									? "bg-control-bg-selected text-text-default"
									: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default",
							)}
						>
							{effortLabel(candidate)}
						</button>
					);
				})}
			</div>
		</div>
	);
}

function RowMeta({ model, withProvider }: { model: WireModel; withProvider: boolean }) {
	const kind = kindLabel(model);
	const cost = costLabel(model);
	return (
		<span className="mt-2 flex min-w-0 items-center gap-4 truncate text-text-subtle tr-text-metadata">
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

/** Maps provider IDs to display names for readability. */
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
	openai: "OpenAI",
	"openai-codex": "OpenAI",
	anthropic: "Anthropic",
	google: "Google",
	mistral: "Mistral",
	groq: "Groq",
	together: "Together",
	perplexity: "Perplexity",
	fireworks: "Fireworks",
	deepseek: "DeepSeek",
	cohere: "Cohere",
	xai: "xAI",
};

function getProviderDisplayName(provider: string): string {
	return PROVIDER_DISPLAY_NAMES[provider.toLowerCase()] ?? provider;
}

/** Groups providers with the same display name under one heading while preserving distinct provider IDs. */
function groupByDisplayName(groups: ProviderGroup[]): ProviderGroup[] {
	const merged = new Map<string, ProviderGroup>();
	for (const group of groups) {
		const displayName = getProviderDisplayName(group.provider);
		const existing = merged.get(displayName);
		if (existing) {
			// Merge models and keep auth from first group that has one
			existing.models = [...existing.models, ...group.models];
			if (!existing.auth && group.auth) {
				existing.auth = group.auth;
			}
		} else {
			// Create new group with display name as the key
			merged.set(displayName, {
				provider: displayName,
				models: [...group.models],
				auth: group.auth,
			});
		}
	}
	return [...merged.values()];
}

/** Icon button for row-level actions (set-default, pin/unpin). */
function RowIconButton({
	testId,
	label,
	active,
	disabled,
	alwaysVisible,
	onClick,
	children,
}: {
	testId: string;
	label: string;
	active?: boolean;
	disabled?: boolean;
	alwaysVisible?: boolean;
	onClick: (event: React.MouseEvent) => void;
	children: React.ReactNode;
}) {
	return (
		<IconTooltip label={label}>
			<button
				type="button"
				data-testid={testId}
				data-active={active}
				aria-label={label}
				aria-pressed={active}
				disabled={disabled}
				onClick={onClick}
				className={cn(
					"flex size-20 shrink-0 items-center justify-center rounded-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:text-control-disabled-text",
					active
						? "text-primary"
						: alwaysVisible
							? "text-text-subtle hover:bg-control-bg-hovered hover:text-text-default"
							: "text-text-subtle opacity-0 hover:bg-control-bg-hovered hover:text-text-default group-hover/row:opacity-100 group-data-[selected=true]/row:opacity-100 focus-visible:opacity-100",
				)}
			>
				{children}
			</button>
		</IconTooltip>
	);
}

/** Section label styled as uppercase secondary text, matching model-count color. */
function SectionLabel({ children }: { children: React.ReactNode }) {
	// 12px above and below: cmdk-group-heading has py-4, so we add pt-8 pb-8 = 4+8=12 each side
	return <span className="block pt-8 pb-8 tr-text-eyebrow text-text-subtle">{children}</span>;
}

/** Inset divider with 12px space above (from last row) and 4px below (before next heading). */
function GroupDivider() {
	return <div className="mt-12 mb-4 h-px bg-border-muted" />;
}

/** Priority order for ALL MODELS providers. */
const PRIORITY_PROVIDERS = ["Anthropic", "OpenAI", "Google"] as const;

/** Provider row with portal-based flyout for models on hover/focus/click. */
function ProviderRowWithFlyout({
	provider,
	models,
	auth,
	renderModel,
	isActive,
	onActivate,
	onDeactivate,
	container,
	mainPopupRef,
}: {
	provider: string;
	models: WireModel[];
	auth: string | null;
	renderModel: (model: WireModel) => React.ReactNode;
	isActive: boolean;
	onActivate: () => void;
	onDeactivate: () => void;
	container?: HTMLElement | null | undefined;
	mainPopupRef?: React.RefObject<HTMLDivElement | null>;
}) {
	const rowRef = useRef<HTMLButtonElement>(null);
	const flyoutRef = useRef<HTMLDivElement>(null);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isActiveRef = useRef(isActive);
	const openedViaKeyboardRef = useRef(false);
	const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

	// Keep ref in sync with prop for use in timeout callbacks
	isActiveRef.current = isActive;

	// Focus first model option when flyout opens via keyboard
	useEffect(() => {
		if (isActive && openedViaKeyboardRef.current && flyoutRef.current) {
			// Small delay to ensure the Command component has rendered
			const timer = setTimeout(() => {
				const firstOption = flyoutRef.current?.querySelector('[data-testid="model-option"]');
				if (firstOption instanceof HTMLElement) {
					firstOption.focus();
				}
				openedViaKeyboardRef.current = false;
			}, 0);
			return () => clearTimeout(timer);
		}
	}, [isActive]);

	// Calculate flyout position when active - bottom-align with main popup
	useEffect(() => {
		if (!isActive || !rowRef.current) {
			setPosition(null);
			return;
		}

		const updatePosition = () => {
			const row = rowRef.current;
			const mainPopup = mainPopupRef?.current;
			if (!row) return;

			const rowRect = row.getBoundingClientRect();
			const mainPopupRect = mainPopup?.getBoundingClientRect();
			const flyoutWidth = 280;
			const flyoutMaxHeight = 280;
			const flyoutOffset = -1; // Negative gap - borders overlap to appear merged

			// Default: position to the right of the main popup (not the row)
			let left = mainPopupRect ? mainPopupRect.right + flyoutOffset : rowRect.right + flyoutOffset;

			// Bottom-align flyout with main popup
			let top = mainPopupRect ? mainPopupRect.bottom - flyoutMaxHeight : rowRect.top;

			// Check if flyout would overflow right edge of viewport
			if (left + flyoutWidth > window.innerWidth - 8) {
				// Position to the left of the main popup instead
				left = mainPopupRect
					? mainPopupRect.left - flyoutWidth - flyoutOffset
					: rowRect.left - flyoutWidth - flyoutOffset;
			}

			// Ensure flyout doesn't overflow top of viewport
			if (top < 8) {
				top = 8;
			}

			// Ensure flyout doesn't overflow bottom of viewport
			const maxTop = window.innerHeight - flyoutMaxHeight - 8;
			if (top > maxTop) {
				top = Math.max(8, maxTop);
			}

			setPosition({ top, left });
		};

		updatePosition();

		// Update position on scroll/resize
		window.addEventListener("scroll", updatePosition, true);
		window.addEventListener("resize", updatePosition);

		return () => {
			window.removeEventListener("scroll", updatePosition, true);
			window.removeEventListener("resize", updatePosition);
		};
	}, [isActive, mainPopupRef]);

	const clearDelayedClose = useCallback(() => {
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
	}, []);

	const scheduleClose = useCallback(() => {
		clearDelayedClose();
		timeoutRef.current = setTimeout(() => {
			// Only deactivate if this row is still the active one
			// (prevents flickering when quickly switching between rows)
			if (isActiveRef.current) {
				onDeactivate();
			}
		}, 150);
	}, [clearDelayedClose, onDeactivate]);

	const handleMouseEnter = useCallback(() => {
		clearDelayedClose();
		onActivate();
	}, [clearDelayedClose, onActivate]);

	const handleMouseLeave = useCallback(() => {
		scheduleClose();
	}, [scheduleClose]);

	const handleFocus = useCallback(() => {
		clearDelayedClose();
		onActivate();
	}, [clearDelayedClose, onActivate]);

	const handleRowKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				openedViaKeyboardRef.current = true;
				onActivate();
			} else if (e.key === "Escape") {
				onDeactivate();
			}
		},
		[onActivate, onDeactivate],
	);

	const handleFlyoutKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				onDeactivate();
				// Return focus to provider row
				rowRef.current?.focus();
			}
		},
		[onDeactivate],
	);

	const handleFlyoutFocusIn = useCallback(() => {
		// Keep flyout open while focus is inside
		clearDelayedClose();
	}, [clearDelayedClose]);

	const handleFlyoutBlur = useCallback(
		(e: React.FocusEvent) => {
			// Check if focus is moving outside the flyout
			const relatedTarget = e.relatedTarget as Node | null;
			const flyout = flyoutRef.current;
			const row = rowRef.current;
			if (
				relatedTarget &&
				(flyout?.contains(relatedTarget) || row?.contains(relatedTarget) || row === relatedTarget)
			) {
				// Focus is staying within flyout or moving to row - keep open
				return;
			}
			// Focus is leaving - schedule close
			scheduleClose();
		},
		[scheduleClose],
	);

	const portalContainer = container ?? document.body;

	return (
		<>
			<button
				ref={rowRef}
				type="button"
				data-testid="provider-row"
				data-provider={provider}
				data-active={isActive}
				aria-expanded={isActive}
				aria-haspopup="listbox"
				onMouseEnter={handleMouseEnter}
				onMouseLeave={handleMouseLeave}
				onFocus={handleFocus}
				onKeyDown={handleRowKeyDown}
				className={cn(
					"flex w-full cursor-pointer items-center gap-8 rounded-sm px-8 py-4 outline-none transition-colors",
					"hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary",
					isActive && "bg-control-bg-selected",
				)}
			>
				<ProviderGlyph provider={provider} className="size-14 shrink-0 text-text-muted" />
				<span className="flex min-w-0 flex-1 items-center gap-8">
					<span className="truncate">{provider}</span>
					<span className="text-text-subtle tr-text-metadata">{models.length}</span>
				</span>
				{auth ? <span className="truncate text-text-subtle tr-text-metadata">{auth}</span> : null}
				<ChevronRight className="size-12 shrink-0 text-text-muted" />
			</button>
			{isActive && position
				? createPortal(
						<div
							ref={flyoutRef}
							role="listbox"
							aria-label={`${provider} models`}
							onMouseEnter={handleMouseEnter}
							onMouseLeave={handleMouseLeave}
							onKeyDown={handleFlyoutKeyDown}
							onFocus={handleFlyoutFocusIn}
							onBlur={handleFlyoutBlur}
							style={{
								position: "fixed",
								top: position.top,
								left: position.left,
								zIndex: 100,
							}}
							className="w-[280px] rounded-md border border-border-default bg-container-elevated-bg shadow-lg"
						>
							<Command className="bg-transparent text-text-muted">
								<CommandList className="max-h-[280px] p-12 [&_[cmdk-item]]:py-4 [&_[cmdk-item]+[cmdk-item]]:mt-2">
									{models.map((m) => renderModel(m))}
								</CommandList>
							</Command>
						</div>,
						portalContainer,
					)
				: null}
		</>
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
		const [activeFlyout, setActiveFlyout] = useState<string | null>(null);
		const mainPopupRef = useRef<HTMLDivElement>(null);

		// Freeze recents when popup opens to prevent reordering during selection
		const [frozenRecents, setFrozenRecents] = useState<WireModel[]>([]);
		useEffect(() => {
			if (open) {
				setFrozenRecents(preferences.recents);
			}
		}, [open, preferences.recents]);

		const openWith = (next: string) => {
			setQuery(next);
			setOpen(true);
			onRefresh(false);
		};

		useImperativeHandle(handleRef, () => ({ open: (q = "") => openWith(q) }));

		const close = () => {
			setOpen(false);
			setQuery("");
			setActiveFlyout(null);
			// Don't reset showAll or expandedProviders to preserve user's navigation state
		};

		// Group models by provider, then merge providers with same display name
		const rawGroups = useMemo(() => {
			const groups = new Map<string, WireModel[]>();
			for (const model of models) {
				const list = groups.get(model.provider);
				if (list) list.push(model);
				else groups.set(model.provider, [model]);
			}
			const providerGroups: ProviderGroup[] = [...groups].map(([provider, list]) => ({
				provider,
				models: list,
				auth: list.map(describeAuth).find((auth) => auth !== null) ?? null,
			}));
			return groupByDisplayName(providerGroups);
		}, [models]);

		// Create a set of pinned and recent model keys to avoid duplicates
		const pinnedKeys = useMemo(
			() => new Set(preferences.favorites.map(modelKey)),
			[preferences.favorites],
		);
		const recentKeys = useMemo(() => new Set(frozenRecents.map(modelKey)), [frozenRecents]);

		const shortlist = preferences.favorites.length > 0 || frozenRecents.length > 0;
		const isSearching = query.trim() !== "";

		// Sort providers to show priority providers first (Anthropic, OpenAI, Google)
		const sortedGroups = useMemo(() => {
			const priorityOrder = new Map<string, number>(PRIORITY_PROVIDERS.map((p, i) => [p, i]));
			return [...rawGroups].sort((a, b) => {
				const aOrder = priorityOrder.get(a.provider) ?? 999;
				const bOrder = priorityOrder.get(b.provider) ?? 999;
				return aOrder - bOrder;
			});
		}, [rawGroups]);

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

		const renderModel = (model: WireModel, section = "flyout") => {
			const pinned = preferences.isFavorite(model);
			const isCurrent = !defaultOption?.active && sameModel(model, current);
			// Model-only match (for visual indicator)
			const isDefaultModel = preferences.isDefaultModel(model);
			// Full match: model + current effort level (for disabled state)
			const isDefaultPair = preferences.isDefault(model, level);
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
						"group/row items-start gap-8",
						isCurrent && "bg-primary-subtle data-[selected=true]:bg-primary-subtle",
					)}
				>
					<ProviderGlyph provider={model.provider} className="mt-2 size-12 text-text-muted" />
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="truncate">{model.name}</span>
						<RowMeta model={model} withProvider={section !== "all"} />
					</span>
					{preferences.supported ? (
						<span className="mt-2 flex shrink-0 items-center gap-2">
							{/* Pin/unpin action */}
							<RowIconButton
								testId="model-pin-toggle"
								label={pinned ? "Unpin" : "Pin"}
								active={pinned}
								alwaysVisible={pinned}
								onClick={(event) => {
									event.stopPropagation();
									preferences.toggleFavorite(model);
								}}
							>
								{pinned ? <UnpinLine className="size-14" /> : <PinLine className="size-14" />}
							</RowIconButton>
							{/* Set as default action */}
							<RowIconButton
								testId="model-set-default"
								label={
									isDefaultPair
										? "Default model and effort"
										: isDefaultModel
											? "Set current effort as default"
											: "Set as default"
								}
								active={isDefaultModel}
								disabled={isDefaultPair}
								onClick={(event) => {
									event.stopPropagation();
									if (!isDefaultPair) {
										preferences.setDefault(model, level);
									}
								}}
							>
								{isDefaultModel ? (
									<RiRadioButtonFill className="size-14 text-primary" />
								) : (
									<RiRadioButtonLine className="size-14" />
								)}
							</RowIconButton>
						</span>
					) : null}
				</CommandItem>
			);
		};

		const effortLevels = current?.thinkingLevels ?? [];
		const following = defaultOption?.active ? defaultOption.resolved : null;
		const pillModel = defaultOption?.active ? (following?.model ?? null) : current;
		const pillLevel = following?.thinkingLevel ?? level;

		return (
			<Popover open={open} onOpenChange={(next) => (next ? openWith("") : close())}>
				<PopoverTrigger
					data-testid="model-selector"
					data-open={open}
					className={cn(
						"flex h-32 min-w-0 items-center gap-8 rounded-sm px-8 tr-text-ui text-text-muted outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:bg-control-bg-selected",
						className,
					)}
				>
					{defaultOption?.active ? (
						<Sparkles className="size-14 shrink-0 text-text-muted" />
					) : pillModel ? (
						<ProviderGlyph provider={pillModel.provider} className="size-14 text-text-muted" />
					) : null}
					<span className="truncate text-text-muted">
						{defaultOption?.active ? "Default" : (pillModel?.name ?? "Select model")}
					</span>
					{pillModel ? (
						<>
							{defaultOption?.active ? (
								<span className="truncate text-text-subtle tr-text-metadata">{pillModel.name}</span>
							) : null}
							<EffortIndicator level={pillLevel} />
						</>
					) : null}
					<ChevronDown className="size-14 shrink-0 text-text-muted" />
				</PopoverTrigger>
				<PopoverContent
					ref={mainPopupRef}
					align="start"
					container={container}
					className="flex max-h-[var(--radix-popover-content-available-height)] w-[min(360px,calc(100vw-16px))] flex-col p-0"
				>
					<Command className="min-h-0 flex-1 bg-transparent text-text-muted">
						<div className="flex items-center border-border-default border-b [&>div]:min-w-0 [&>div]:flex-1 [&>div]:border-none">
							<CommandInput
								placeholder="Search model"
								value={query}
								onValueChange={setQuery}
								className="text-text-muted placeholder:text-text-muted"
							/>
							<IconTooltip label={refreshing ? "Updating catalog…" : "Refresh catalog"}>
								<button
									type="button"
									data-testid="model-refresh"
									data-refreshing={refreshing}
									disabled={refreshing}
									onClick={() => onRefresh(true)}
									className="mr-8 flex size-24 shrink-0 items-center justify-center rounded-sm text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default disabled:text-text-subtle disabled:hover:bg-transparent"
								>
									<RefreshCw className={cn("size-14", refreshing && "animate-spin")} />
								</button>
							</IconTooltip>
						</div>
						<CommandList className="max-h-[340px] min-h-0 flex-1 px-12 [&_[cmdk-group-items]]:space-y-2 [&_[cmdk-item]]:py-4">
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
											"items-start gap-8",
											defaultOption.active &&
												"bg-primary-subtle data-[selected=true]:bg-primary-subtle",
										)}
									>
										<Sparkles className="mt-2 size-12 shrink-0 text-text-muted" />
										<span className="flex min-w-0 flex-1 flex-col">
											<span>Default</span>
											<span className="truncate text-text-subtle tr-text-metadata">
												{defaultOption.resolved?.model
													? `Follows Settings → Models · ${defaultOption.resolved.model.name} · ${defaultOption.resolved.thinkingLevel}`
													: "Follows Settings → Models"}
											</span>
										</span>
									</CommandItem>
								</CommandGroup>
							) : null}
							{preferences.favorites.length > 0 ? (
								<>
									{defaultOption ? <GroupDivider /> : null}
									<CommandGroup heading={<SectionLabel>PINNED</SectionLabel>}>
										{preferences.favorites.map((m) => renderModel(m, "pinned"))}
									</CommandGroup>
								</>
							) : null}
							{frozenRecents.length > 0 ? (
								<>
									{defaultOption || preferences.favorites.length > 0 ? <GroupDivider /> : null}
									<CommandGroup heading={<SectionLabel>RECENT</SectionLabel>}>
										{frozenRecents.map((m) => renderModel(m, "recent"))}
									</CommandGroup>
								</>
							) : null}
							{isSearching ? (
								// When searching, show all matching models without provider grouping
								rawGroups.map((group) => group.models.map((m) => renderModel(m, "all")))
							) : (
								// Provider rows with flyouts - shows all providers with models on hover
								<>
									{defaultOption || shortlist ? <GroupDivider /> : null}
									<CommandGroup heading={<SectionLabel>ALL MODELS</SectionLabel>} className="pb-12">
										{sortedGroups.map((group) => {
											// Filter out models already shown in Pinned or Recent
											const uniqueModels = group.models.filter(
												(m) => !pinnedKeys.has(modelKey(m)) && !recentKeys.has(modelKey(m)),
											);
											if (uniqueModels.length === 0) return null;
											return (
												<ProviderRowWithFlyout
													key={group.provider}
													provider={group.provider}
													models={uniqueModels}
													auth={group.auth}
													renderModel={(m) => renderModel(m, "all")}
													isActive={activeFlyout === group.provider}
													onActivate={() => setActiveFlyout(group.provider)}
													onDeactivate={() => setActiveFlyout(null)}
													container={container}
													mainPopupRef={mainPopupRef}
												/>
											);
										})}
									</CommandGroup>
								</>
							)}
						</CommandList>
					</Command>
					{current && effortLevels.length > 0 ? (
						<EffortSegmentedControl
							level={level}
							levels={effortLevels}
							onSelectLevel={onSelectLevel}
						/>
					) : null}
				</PopoverContent>
			</Popover>
		);
	},
);
