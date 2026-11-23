import { sameModel, type WireModel } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { useLocalKeys } from "@thinkrail/ui/local-keys";
import { Switch } from "@thinkrail/ui/switch";
import { useTreeItem } from "@thinkrail/ui/tree-item";
import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, type MouseEvent, useMemo, useState } from "react";
import { formatContext, groupByProvider } from "@/chat/modelPicker";
import { LOCAL_KEY_DEFAULTS } from "@/keybindings";
import { SettingsGroup } from "@/settingsKit";
import { type ModelRef, useAppStore } from "@/store";
import {
	fromItemControl,
	MODEL_TREE,
	MODEL_TREE_ROW,
	ProviderTreeItem,
	stopRowClick,
} from "./ModelProviderTree";
import { SETTING } from "./settingsCatalog";
import { Tree } from "./treeNavigation";

export type Shown = "all" | "some" | "none";

export function shownState(shown: number, total: number): Shown {
	return shown === total ? "all" : shown === 0 ? "none" : "some";
}

const PRESSED: Record<Shown, boolean | "mixed"> = { all: true, some: "mixed", none: false };

type Visibility = (model: ModelRef, visible: boolean) => void;

function useRowKeys(onToggle: () => void, onShow: () => void, enter: boolean) {
	const keys = useLocalKeys("settings", LOCAL_KEY_DEFAULTS.settings);
	return (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.defaultPrevented || isImeComposing(event.nativeEvent)) return;
		if (event.target !== event.currentTarget) return;
		if (keys.match(event.nativeEvent) === "settings.reset") {
			event.preventDefault();
			onShow();
			return;
		}
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		if (event.key !== " " && !(enter && event.key === "Enter")) return;
		event.preventDefault();
		onToggle();
	};
}

function ProviderShownToggle({
	provider,
	state,
	label,
	tabIndex,
	onToggle,
}: {
	provider: string;
	state: Shown;
	label: string;
	tabIndex: number;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={PRESSED[state]}
			aria-label={label}
			tabIndex={tabIndex}
			data-setting-toggle=""
			data-testid="visible-models-provider-toggle"
			data-provider={provider}
			data-state={state}
			onClick={(event: MouseEvent<HTMLButtonElement>) => {
				stopRowClick(event);
				onToggle();
			}}
			className="grid h-24 w-40 shrink-0 place-items-center rounded-full transition-colors hover:bg-control-bg-hovered focus-visible:focus-ring motion-reduce:transition-none"
		>
			<span
				aria-hidden="true"
				className={cn(
					"relative h-20 w-36 rounded-full transition-colors motion-reduce:transition-none",
					state === "none" ? "bg-border-default" : "bg-primary",
				)}
			>
				{state === "some" ? (
					<span className="absolute top-8 left-12 h-4 w-12 rounded-full bg-control-primary-text" />
				) : (
					<span
						className={cn(
							"absolute top-2 left-2 size-16 rounded-full transition-transform motion-reduce:transition-none",
							state === "all"
								? "translate-x-16 bg-control-primary-text"
								: "bg-container-workspace-bg",
						)}
					/>
				)}
			</span>
		</button>
	);
}

function ModelVisibilityItem({
	model,
	hidden,
	setVisible,
}: {
	model: WireModel;
	hidden: boolean;
	setVisible: Visibility;
}) {
	const t = useT();
	const {
		role: _treeitem,
		tabIndex,
		...item
	} = useTreeItem(`model:${model.provider}/${model.id}`, {
		level: 2,
		label: model.name,
	});
	const toggle = () => setVisible(model, hidden);
	const rowKeys = useRowKeys(toggle, () => setVisible(model, true), true);
	const window = formatContext(model.contextWindow);
	return (
		<li role="none">
			<div
				role="treeitem"
				tabIndex={tabIndex ?? 0}
				{...item}
				aria-checked={!hidden}
				data-testid="visible-models-model"
				data-provider={model.provider}
				data-model-id={model.id}
				data-hidden={hidden || undefined}
				className={cn(MODEL_TREE_ROW, "pl-24")}
				onClick={(event) => {
					if (!fromItemControl(event)) toggle();
				}}
				onKeyDown={rowKeys}
			>
				<span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-8">
					<span className={cn("tr-text-ui", hidden ? "text-text-muted" : "text-text-default")}>
						{model.name}
					</span>
					<span className="text-text-muted tr-text-metadata">
						{model.reasoning ? t("settings.visibleModels.windowReasoning", { window }) : window}
					</span>
				</span>
				<Switch
					checked={!hidden}
					label={t("settings.visibleModels.show", { name: model.name })}
					testId={`model-visibility-${model.provider}-${model.id}`}
					tabIndex={tabIndex ?? 0}
					onClick={stopRowClick}
					onCheckedChange={(visible) => setVisible(model, visible)}
				/>
			</div>
		</li>
	);
}

function ProviderVisibility({
	provider,
	auth,
	models,
	isHidden,
	expanded,
	onToggleExpanded,
	setVisible,
}: {
	provider: string;
	auth: string | null;
	models: readonly WireModel[];
	isHidden: (model: WireModel) => boolean;
	expanded: boolean;
	onToggleExpanded: () => void;
	setVisible: Visibility;
}) {
	const t = useT();
	const shown = models.filter((model) => !isHidden(model)).length;
	const state = shownState(shown, models.length);
	const setAll = () => {
		for (const model of models) setVisible(model, state !== "all");
	};
	const showAll = () => {
		for (const model of models) setVisible(model, true);
	};
	const rowKeys = useRowKeys(setAll, showAll, false);
	const summary = t("settings.visibleModels.shownCount", { shown, total: models.length });
	return (
		<ProviderTreeItem
			id={`provider:${provider}`}
			provider={provider}
			meta={auth}
			summary={summary}
			expanded={expanded}
			testId="visible-models-provider"
			onToggle={onToggleExpanded}
			onKeyDown={rowKeys}
			trailing={(tabIndex) => (
				<ProviderShownToggle
					provider={provider}
					state={state}
					label={t("settings.visibleModels.showProvider", { provider, summary })}
					tabIndex={tabIndex}
					onToggle={setAll}
				/>
			)}
		>
			{models.map((model) => (
				<ModelVisibilityItem
					key={model.id}
					model={model}
					hidden={isHidden(model)}
					setVisible={setVisible}
				/>
			))}
		</ProviderTreeItem>
	);
}

export function VisibleModelsTree({
	models,
	hiddenModels,
	defaultExpanded = [],
	setVisible,
}: {
	models: readonly WireModel[];
	hiddenModels: readonly ModelRef[];
	defaultExpanded?: readonly string[];
	setVisible: Visibility;
}) {
	const t = useT();
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(defaultExpanded));
	const groups = useMemo(() => groupByProvider(t, models), [t, models]);
	const isHidden = (model: WireModel) => hiddenModels.some((hidden) => sameModel(hidden, model));
	const hiddenCount = models.filter(isHidden).length;
	const toggle = (provider: string) =>
		setExpanded((current) => {
			const next = new Set(current);
			if (!next.delete(provider)) next.add(provider);
			return next;
		});
	return (
		<SettingsGroup
			title={t(SETTING.visibleModels.label)}
			description={
				<span className="flex flex-wrap gap-x-4">
					<span>{t(SETTING.visibleModels.description)}</span>
					<span>
						{hiddenCount === 0
							? t("settings.visibleModels.allShown")
							: t("settings.visibleModels.hidden", { count: hiddenCount })}
					</span>
				</span>
			}
			testId="visible-models-group"
		>
			{groups.length === 0 ? (
				<p
					data-setting-id={SETTING.visibleModels.id}
					className="px-8 py-12 text-text-muted tr-text-ui"
				>
					{t("settings.visibleModels.noModels")}
				</p>
			) : (
				<div
					data-setting-row={SETTING.visibleModels.id}
					data-setting-id={SETTING.visibleModels.id}
					data-testid="visible-models"
					className="py-12"
				>
					<Tree
						label={t(SETTING.visibleModels.label)}
						focusList="settings:visible-models"
						leaveAtEdges
						className={MODEL_TREE}
					>
						{groups.map((group) => (
							<ProviderVisibility
								key={group.provider}
								provider={group.provider}
								auth={group.auth}
								models={group.models}
								isHidden={isHidden}
								expanded={expanded.has(group.provider)}
								onToggleExpanded={() => toggle(group.provider)}
								setVisible={setVisible}
							/>
						))}
					</Tree>
				</div>
			)}
		</SettingsGroup>
	);
}

export function VisibleModelsSettings({ models }: { models: WireModel[] }) {
	const hiddenModels = useAppStore((s) => s.hiddenModels);
	const setModelVisibility = useAppStore((s) => s.setModelVisibility);
	return (
		<VisibleModelsTree
			models={models}
			hiddenModels={hiddenModels}
			setVisible={setModelVisibility}
		/>
	);
}
