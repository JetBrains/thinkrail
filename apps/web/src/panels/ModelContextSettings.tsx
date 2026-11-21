import { RiArrowGoBackLine as ArrowGoBack } from "@remixicon/react";
import {
	CONTEXT_WINDOW_SETTINGS_PROTOCOL_VERSION,
	CUSTOM_MODEL_CONTEXT_PROTOCOL_VERSION,
	isCustomEndpointId,
	isModelContextWindow,
	isSharedModelContextTarget,
	MODEL_CONTEXT_WINDOW_LIMITS,
	type ModelContextSetting,
	type ModelContextTarget,
	type ModelContextWindowLimits,
	modelContextWindowLimits,
	type WsMethodMap,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { localeOf, type Translator, t as translate, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
	SETTINGS_INPUT,
	SETTINGS_TAG,
	SettingsChoice,
	type SettingsChoiceOption,
	SettingsGroup,
	SettingsLine,
	SettingsRow,
	useSettingsDraft,
} from "@/settingsKit";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import type { CustomEndpointsState } from "./CustomEndpointsSettings";
import { MODEL_TREE, MODEL_TREE_ROW, ProviderTreeItem, stopRowClick } from "./ModelProviderTree";
import { SETTING, type SettingProps, settingProps } from "./settingsCatalog";
import { Tree, useTreeItem } from "./treeNavigation";

const PRESETS = [
	{ id: "default", label: "common.default", override: null },
	{
		id: "1m",
		label: "settings.modelContext.preset.oneMillion",
		override: MODEL_CONTEXT_WINDOW_LIMITS.max,
	},
	{ id: "custom", label: "settings.modelContext.preset.custom", override: undefined },
] as const satisfies readonly {
	id: string;
	label: MessageKey;
	override: number | null | undefined;
}[];

type PresetId = (typeof PRESETS)[number]["id"];

const tokens = (t: Translator, value: number) => value.toLocaleString(localeOf(t));
export const tokenRange = (
	t: Translator,
	limits: ModelContextWindowLimits = MODEL_CONTEXT_WINDOW_LIMITS,
) => `${tokens(t, limits.min)}–${tokens(t, limits.max)}`;

function supported(
	protocolVersion: number | null,
	minimum: number = CONTEXT_WINDOW_SETTINGS_PROTOCOL_VERSION,
): boolean {
	return protocolVersion !== null && protocolVersion >= minimum;
}

export function isContextWindowText(
	text: string,
	limits: ModelContextWindowLimits = MODEL_CONTEXT_WINDOW_LIMITS,
): boolean {
	return /^\d+$/.test(text) && isModelContextWindow(Number(text), limits);
}

export function contextPreset(override: number | null | undefined): PresetId | null {
	if (override === undefined) return null;
	return PRESETS.find((preset) => preset.override === override)?.id ?? "custom";
}

function presetOptions(t: Translator, testId: string): SettingsChoiceOption<PresetId>[] {
	return PRESETS.map((preset) => ({
		id: preset.id,
		label: t(preset.label),
		testId: `${testId}-${preset.id}`,
	}));
}

interface ContextPick {
	revision: string;
	custom: number | null;
	writes: readonly (number | null)[];
}

export interface ContextLimit {
	value: PresetId | null;
	latest: number | null | undefined;
	select: (id: PresetId) => void;
	save: (override: number) => void;
	reset: () => void;
}

export function useContextLimit(
	override: number | null | undefined,
	revision: string,
	onChange: (override: number | null) => void,
): ContextLimit {
	const [pick, setPick] = useState<ContextPick>({ revision, custom: null, writes: [] });
	let held = pick;
	if (pick.revision !== revision) {
		const echo = override === undefined ? -1 : pick.writes.indexOf(override);
		const custom = pick.custom !== null && echo < pick.custom ? pick.custom - echo - 1 : null;
		held =
			echo < 0
				? { revision, custom: null, writes: [] }
				: { revision, custom, writes: pick.writes.slice(echo + 1) };
		setPick(held);
	}
	const latest = held.writes.length > 0 ? held.writes.at(-1) : override;
	const write = (next: number | null, custom: number | null) => {
		setPick({ revision: held.revision, custom, writes: [...held.writes, next] });
		onChange(next);
	};
	const select = (id: PresetId) => {
		const next = id === "1m" ? MODEL_CONTEXT_WINDOW_LIMITS.max : null;
		if (id === "custom") setPick({ ...held, custom: held.writes.length });
		else if (next !== override || next !== latest) write(next, null);
		else setPick({ ...held, custom: null });
	};
	return {
		value: held.custom === null ? contextPreset(override) : "custom",
		latest,
		select,
		save: (next) => write(next, held.custom),
		reset: () => write(null, null),
	};
}

function ContextTokensField({
	name,
	override,
	limits,
	testId,
	tabIndex,
	onChange,
}: {
	name: string;
	override: number | null | undefined;
	limits: ModelContextWindowLimits;
	testId: string;
	tabIndex: number;
	onChange: (override: number) => void;
}) {
	const t = useT();
	const errorId = useId();
	const range = tokenRange(t, limits);
	const custom = override != null && override !== MODEL_CONTEXT_WINDOW_LIMITS.max;
	const { invalid, dirty, inputProps } = useSettingsDraft({
		saved: custom ? String(override) : "",
		isValid: (draft) => draft.trim() === "" || isContextWindowText(draft.trim(), limits),
		commit: (draft) => {
			const text = draft.trim();
			if (!isContextWindowText(text, limits) || Number(text) === override) return undefined;
			onChange(Number(text));
			return undefined;
		},
	});
	return (
		<span className="flex flex-col items-end gap-2">
			<input
				type="text"
				inputMode="numeric"
				tabIndex={tabIndex}
				{...inputProps}
				placeholder={range}
				aria-label={t("settings.modelContext.tokensFor", { name })}
				aria-describedby={invalid ? errorId : undefined}
				data-testid={`${testId}-input`}
				data-setting-clean={dirty ? undefined : ""}
				className={cn(SETTINGS_INPUT, "w-100 text-right")}
			/>
			{invalid ? (
				<span id={errorId} className="text-feedback-error tr-text-metadata">
					{t("settings.modelContext.invalid", { range })}
				</span>
			) : null}
		</span>
	);
}

function ContextLimitControl({
	name,
	testId,
	limit,
	limits,
	tabIndex,
}: {
	name: string;
	testId: string;
	limit: ContextLimit;
	limits: ModelContextWindowLimits;
	tabIndex: number;
}) {
	const t = useT();
	return (
		<span className="flex flex-wrap items-start justify-end gap-8">
			<SettingsChoice
				label={t("settings.modelContext.controlLabel", { name })}
				options={presetOptions(t, testId)}
				value={limit.value}
				cost="cheap"
				onSelect={limit.select}
			/>
			{limit.value === "custom" ? (
				<ContextTokensField
					name={name}
					override={limit.latest}
					limits={limits}
					testId={testId}
					tabIndex={tabIndex}
					onChange={limit.save}
				/>
			) : null}
		</span>
	);
}

function SharedContextRow({
	row,
	description,
	override,
	revision,
	onChange,
}: {
	row: SettingProps;
	description: string;
	override: number | null | undefined;
	revision: string;
	onChange: (override: number | null) => void;
}) {
	const limit = useContextLimit(override, revision, onChange);
	return (
		<div
			data-testid="context-limit-all"
			data-context-override={override === undefined ? "mixed" : String(override)}
		>
			<SettingsRow
				{...row}
				description={description}
				control={
					<ContextLimitControl
						name={row.label}
						testId="context-limit-all"
						limit={limit}
						limits={MODEL_CONTEXT_WINDOW_LIMITS}
						tabIndex={0}
					/>
				}
				reset={{ changed: override !== null, onReset: limit.reset }}
			/>
		</div>
	);
}

function ContextModelItem({
	model,
	limits,
	onChange,
}: {
	model: ModelContextSetting;
	limits: ModelContextWindowLimits;
	onChange: (override: number | null) => void;
}) {
	const t = useT();
	const revision = String(model.override);
	const limit = useContextLimit(model.override, revision, onChange);
	const {
		role: _treeitem,
		tabIndex: rovingTabIndex,
		...item
	} = useTreeItem(`${model.provider}/${model.id}`, { level: 2, label: model.name });
	const name = `${model.name} (${model.provider})`;
	const testId = `context-limit-${model.provider}-${model.id}`;
	const changed = model.override !== null;
	const tabIndex = rovingTabIndex ?? 0;

	return (
		<li role="none">
			<div
				role="treeitem"
				tabIndex={tabIndex}
				{...item}
				data-testid={testId}
				data-context-override={String(model.override)}
				data-changed={changed || undefined}
				className={cn(MODEL_TREE_ROW, "justify-between pl-24")}
			>
				<span className="flex min-w-160 flex-1 flex-col gap-2">
					<span className="flex flex-wrap items-center gap-8">
						<span className="tr-text-ui text-text-default">{model.name}</span>
						{changed ? (
							<span className={cn(SETTINGS_TAG, "text-primary")}>{t("settings.kit.changed")}</span>
						) : null}
					</span>
					<span className="tr-text-metadata text-text-muted">
						{model.override === null
							? t("settings.modelContext.modelDescriptionDefault", {
									tokens: tokens(t, model.contextWindow),
								})
							: t("settings.modelContext.modelDescription", {
									tokens: tokens(t, model.contextWindow),
								})}
					</span>
				</span>
				<span className="flex flex-wrap items-start justify-end gap-8">
					<SettingsChoice
						label={t("settings.modelContext.controlLabel", { name })}
						options={presetOptions(t, testId)}
						value={limit.value}
						cost="cheap"
						onSelect={limit.select}
					/>
					{limit.value === "custom" ? (
						<ContextTokensField
							name={name}
							override={limit.latest}
							limits={limits}
							testId={testId}
							tabIndex={tabIndex}
							onChange={limit.save}
						/>
					) : null}
					{changed ? (
						<Button
							variant="ghost"
							size="m"
							iconLeft={ArrowGoBack}
							tabIndex={tabIndex}
							data-setting-reset=""
							data-testid={`${testId}-reset`}
							aria-label={t("settings.kit.resetLabel", { label: name })}
							onClick={(event) => {
								stopRowClick(event);
								limit.reset();
							}}
						>
							{t("settings.kit.reset")}
						</Button>
					) : null}
				</span>
			</div>
		</li>
	);
}

function groupByProvider(rows: readonly ModelContextSetting[]): [string, ModelContextSetting[]][] {
	const groups = new Map<string, ModelContextSetting[]>();
	for (const row of rows) groups.set(row.provider, [...(groups.get(row.provider) ?? []), row]);
	return [...groups];
}

export function ModelContextLoadFailed({
	pending,
	onRetry,
}: {
	pending: boolean;
	onRetry: () => void;
}) {
	const t = useT();
	return (
		<div
			className="flex items-center gap-8 border-border-muted border-b py-12"
			role="alert"
			data-testid="model-context-load-failed"
		>
			<p className="tr-text-ui text-text-muted">{t("settings.modelContext.loadFailed")}</p>
			<Button variant="ghost" size="m" tabIndex={0} disabled={pending} onClick={onRetry}>
				{t("common.retry")}
			</Button>
		</div>
	);
}

export function customServerIds(
	customEndpoints: CustomEndpointsState | null,
): ReadonlySet<string> | null {
	if (customEndpoints?.endpoints) return new Set(customEndpoints.endpoints.map(({ id }) => id));
	return customEndpoints === null || customEndpoints.failed ? new Set() : null;
}

export function modelContextRows(
	settings: ModelContextSetting[] | null,
	customServers: ReadonlySet<string> | null,
): ModelContextSetting[] | null {
	if (settings === null || customServers === null) return null;
	return settings.filter((model) => !customServers.has(model.provider));
}

export function modelContextLimitsFor(
	provider: string,
	protocolVersion: number | null,
): ModelContextWindowLimits {
	return supported(protocolVersion, CUSTOM_MODEL_CONTEXT_PROTOCOL_VERSION)
		? modelContextWindowLimits(provider)
		: MODEL_CONTEXT_WINDOW_LIMITS;
}

export function ModelContextControls({
	protocolVersion,
	settings,
	customServers,
	pending,
	failed,
	defaultExpanded = [],
	onChange,
	onRetry,
}: {
	protocolVersion: number | null;
	settings: ModelContextSetting[] | null;
	customServers: ReadonlySet<string> | null;
	pending: boolean;
	failed: boolean;
	defaultExpanded?: readonly string[];
	onChange: (target: ModelContextTarget, override: number | null) => void;
	onRetry: () => void;
}) {
	const t = useT();
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(defaultExpanded));
	if (!supported(protocolVersion)) return null;
	const rows = modelContextRows(settings, customServers);
	const gpt = rows?.filter((model) => !isCustomEndpointId(model.provider)) ?? [];
	const shared = gpt.filter(isSharedModelContextTarget);
	const external = gpt.length - shared.length;
	const first = shared[0]?.override;
	const sharedOverride = shared.every((model) => model.override === first) ? first : undefined;
	const revision = JSON.stringify(rows?.map((model) => [model.provider, model.id, model.override]));
	const sharedSummary =
		sharedOverride === undefined
			? t("settings.modelContext.customizedByModel")
			: t("settings.modelContext.availableModels", { count: shared.length });
	const sharedDescription =
		external > 0
			? t("settings.modelContext.withExternal", {
					summary: sharedSummary,
					external: t("settings.modelContext.externalKept", {
						count: external,
						range: tokenRange(t),
					}),
				})
			: sharedSummary;
	const row = settingProps(t, SETTING.contextWindow);
	const toggle = (provider: string) =>
		setExpanded((current) => {
			const next = new Set(current);
			if (!next.delete(provider)) next.add(provider);
			return next;
		});

	return (
		<SettingsGroup
			title={t("settings.modelContext.title")}
			description={t("settings.modelContext.note")}
			testId="settings-model-context"
		>
			{failed ? (
				<SettingsLine rowId={row.settingId}>
					<ModelContextLoadFailed pending={pending} onRetry={onRetry} />
				</SettingsLine>
			) : rows === null || rows.length === 0 ? (
				<SettingsRow
					{...row}
					description={rows === null ? t("common.loading") : t("settings.modelContext.noModels")}
				/>
			) : (
				<>
					{shared.length > 0 ? (
						<SharedContextRow
							row={row}
							description={sharedDescription}
							override={sharedOverride}
							revision={revision}
							onChange={(override) => onChange("available", override)}
						/>
					) : null}
					<div data-setting-row="context-window-by-model" className="py-12">
						<Tree
							label={t("settings.modelContext.byModel")}
							focusList="settings:context-window"
							leaveAtEdges
							className={MODEL_TREE}
						>
							{groupByProvider(rows).map(([provider, models]) => {
								const customized = models.filter((model) => model.override !== null).length;
								return (
									<ProviderTreeItem
										key={provider}
										id={`provider:${provider}`}
										provider={provider}
										meta={t("settings.modelContext.modelCount", { count: models.length })}
										summary={
											customized > 0
												? t("settings.modelContext.customizedCount", {
														count: customized,
														total: models.length,
													})
												: t("settings.modelContext.allDefault")
										}
										summaryChanged={customized > 0}
										expanded={expanded.has(provider)}
										testId="model-context-provider"
										onToggle={() => toggle(provider)}
									>
										{models.map((model) => (
											<ContextModelItem
												key={model.id}
												model={model}
												limits={modelContextLimitsFor(model.provider, protocolVersion)}
												onChange={(override) =>
													onChange({ provider: model.provider, id: model.id }, override)
												}
											/>
										))}
									</ProviderTreeItem>
								);
							})}
						</Tree>
					</div>
				</>
			)}
		</SettingsGroup>
	);
}

export interface ModelContextState {
	settings: ModelContextSetting[] | null;
	pending: boolean;
	failed: boolean;
	retry: () => void;
	change: (target: ModelContextTarget, contextWindow: number | null) => Promise<boolean>;
}

export function useModelContextSettings(minimumProtocol: number): ModelContextState | null {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const providerVersion = useAppStore((state) => state.providerVersion);
	const models = useAppStore((state) => state.models);
	const [settings, setSettings] = useState<ModelContextSetting[] | null>(null);
	const [pending, setPending] = useState(true);
	const [failed, setFailed] = useState(false);
	const sequence = useRef(0);
	const queue = useRef<Promise<boolean>>(Promise.resolve(true));

	const synchronize = useCallback(
		async (change?: WsMethodMap["model.setContextWindow"]["params"]) => {
			if (!supported(protocolVersion, minimumProtocol)) return false;
			const current = ++sequence.current;
			setPending(true);
			const request = change
				? () => getTransport().request("model.setContextWindow", change)
				: () => getTransport().request("model.contextSettings", {});
			let next: ModelContextSetting[] | undefined;
			try {
				next = await request();
			} catch {}
			if (next === undefined && change)
				toast.error(translate("settings.modelContext.updateFailed"));
			if (current !== sequence.current) return next !== undefined;
			if (next === undefined) setFailed(true);
			else if (providerVersion === useAppStore.getState().providerVersion) {
				setSettings(next);
				setFailed(false);
			}
			setPending(false);
			return next !== undefined;
		},
		[protocolVersion, minimumProtocol, providerVersion],
	);

	useEffect(() => {
		void synchronize();
		return () => {
			sequence.current++;
		};
	}, [models, synchronize]);

	if (!supported(protocolVersion, minimumProtocol)) return null;
	return {
		settings,
		pending,
		failed,
		retry: () => void synchronize(),
		change: (target, contextWindow) => {
			const run = queue.current.then(() => synchronize({ target, contextWindow }));
			queue.current = run;
			return run;
		},
	};
}

export function ModelContextSettings({
	customEndpoints,
}: {
	customEndpoints: CustomEndpointsState | null;
}) {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const context = useModelContextSettings(CONTEXT_WINDOW_SETTINGS_PROTOCOL_VERSION);
	if (!context) return null;
	return (
		<ModelContextControls
			protocolVersion={protocolVersion}
			settings={context.settings}
			customServers={customServerIds(customEndpoints)}
			pending={context.pending}
			failed={context.failed}
			onRetry={context.retry}
			onChange={(target, override) => void context.change(target, override)}
		/>
	);
}
