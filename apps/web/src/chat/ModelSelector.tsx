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
import { type Translator, useT } from "@thinkrail/locales/react";
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
import { formatContext } from "./modelPicker";
import { ProviderGlyph } from "./ProviderGlyph";
import {
	GROUPED_ROW,
	type GroupExpansion,
	groupRowValue,
	initialGroupExpansion,
	NO_MODELS_HINT,
	type PickerGroup,
	PROVIDER_GROUP,
	pickerEmptyState,
	pickerFilter,
	pickerGroups,
	rowValue,
	toggleGroup,
} from "./pickerGroups";
import type { ModelPreferences } from "./useModelPreferences";

function subLine(t: Translator, model: WireModel): string {
	const parts = [t("chat.modelPicker.context", { size: formatContext(model.contextWindow) })];
	if (model.reasoning) parts.push(t("chat.modelPicker.reasoning"));
	return parts.join(" · ");
}

function rowKeywords(model: WireModel): string[] {
	return [model.name, model.id, model.provider];
}

function groupRow(model: WireModel) {
	return { value: rowValue("all", model), keywords: rowKeywords(model) };
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
	preferences?: ModelPreferences;
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [expansion, setExpansion] = useState<GroupExpansion>(() => initialGroupExpansion(null, []));

	const pinnedModels = preferences?.favorites ?? [];
	const searching = query !== "";
	const groups = pickerGroups(t, models, {
		pinned: pinnedModels,
		query,
		expansion,
		row: groupRow,
	});
	const emptyState = pickerEmptyState(query, models.length);

	const select = (model: WireModel) => {
		onSelect(model);
		setOpen(false);
		setQuery("");
	};

	const renderModel = (model: WireModel, section: string) => {
		const isCurrent = sameModel(current, model);
		const isPinned = pinnedModels.some((pinned) => sameModel(pinned, model));
		const grouped = section === "all";
		return (
			<CommandItem
				key={rowValue(section, model)}
				value={rowValue(section, model)}
				keywords={rowKeywords(model)}
				data-testid="model-option"
				data-model-id={model.id}
				data-provider={model.provider}
				onSelect={() => select(model)}
				className={cn(
					"group/row items-start gap-8 py-4",
					grouped && GROUPED_ROW,
					isCurrent && "bg-primary-subtle data-[selected=true]:bg-primary-subtle",
				)}
			>
				{grouped ? null : (
					<ProviderGlyph provider={model.provider} className="mt-2 text-text-muted" />
				)}
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="truncate">{model.name}</span>
					<span className="truncate text-text-muted tr-text-metadata">{subLine(t, model)}</span>
				</span>
				<span className="mt-2 shrink-0 text-text-subtle tr-text-metadata">{model.id}</span>
				{isCurrent ? <Check className="mt-2 size-14 shrink-0 text-primary" /> : null}
				{preferences?.supported ? (
					<IconButton
						icon={isPinned ? StarFill : StarLine}
						size="s"
						data-testid="model-favorite-toggle"
						data-favorite={isPinned}
						label={
							isPinned
								? t("chat.modelPicker.unpin", { model: model.name })
								: t("chat.modelPicker.pin", { model: model.name })
						}
						aria-pressed={isPinned}
						selected={isPinned}
						onClick={(event) => {
							event.stopPropagation();
							preferences.toggleFavorite(model);
						}}
						className={cn(
							"mt-2 shrink-0",
							!isPinned &&
								"opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 group-data-[selected=true]/row:opacity-100",
						)}
					/>
				) : null}
			</CommandItem>
		);
	};

	const renderGroupHeader = (group: PickerGroup) => (
		<CommandItem
			value={groupRowValue(group.provider)}
			data-testid="model-group-toggle"
			data-provider={group.provider}
			aria-expanded={group.expanded}
			onSelect={() => setExpansion((prev) => toggleGroup(prev, group.provider, searching))}
			className="gap-8 py-8"
		>
			<ProviderGlyph provider={group.provider} className="text-text-muted" />
			<span className="min-w-0 flex-1 truncate tr-text-emphasis">{group.provider}</span>
			<span className="shrink-0 text-text-muted tr-text-metadata">{group.count}</span>
			{group.expanded ? (
				<ChevronDown className="size-14 shrink-0 text-text-muted" />
			) : (
				<ChevronRight className="size-14 shrink-0 text-text-muted" />
			)}
		</CommandItem>
	);

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) {
					onRefresh(false);
					setQuery("");
					setExpansion(initialGroupExpansion(current, pinnedModels));
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
					{current?.name ?? (placeholder || t("chat.modelPicker.selectModel"))}
				</span>
				<ChevronDown className="size-16 shrink-0 text-text-muted" />
			</PopoverTrigger>
			<PopoverContent align="start" container={container} className="w-340 p-0">
				<Command className="min-h-0 flex-1 bg-transparent" filter={pickerFilter(groups, groupRow)}>
					<CommandInput
						placeholder={t("chat.modelPicker.search")}
						value={query}
						onValueChange={setQuery}
					/>
					<CommandList className="max-h-340 min-h-0 flex-1 pb-24">
						{emptyState === "no-match" ? (
							<CommandEmpty>{t("chat.modelPicker.noMatch")}</CommandEmpty>
						) : null}
						{emptyState === "no-models" ? (
							<p className="px-8 py-12 text-center text-text-muted tr-text-ui">
								{t(NO_MODELS_HINT)}
							</p>
						) : null}
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
						{pinnedModels.length > 0 && (
							<CommandGroup heading={t("chat.modelPicker.pinned")}>
								{pinnedModels.map((m) => renderModel(m, "pinned"))}
							</CommandGroup>
						)}
						{groups.map((group) => (
							<CommandGroup key={group.provider} className={PROVIDER_GROUP}>
								{renderGroupHeader(group)}
								{group.expanded ? group.models.map((m) => renderModel(m, "all")) : null}
							</CommandGroup>
						))}
					</CommandList>
				</Command>
				<div className="pointer-events-none relative -mt-24 flex items-end justify-end bg-[linear-gradient(to_top,var(--container-elevated-bg),transparent)] px-8 pt-24 pb-8">
					<Button
						variant="outline"
						size="m"
						iconLeft={RefreshCw}
						loading={refreshing}
						data-testid="model-refresh"
						data-refreshing={refreshing}
						disabled={refreshing}
						onClick={() => onRefresh(true)}
						className="pointer-events-auto"
					>
						{refreshing ? t("chat.modelPicker.updating") : t("chat.modelPicker.refresh")}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
