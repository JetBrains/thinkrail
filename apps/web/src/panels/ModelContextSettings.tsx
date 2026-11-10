import { RiArrowDownSLine, RiArrowRightSLine } from "@remixicon/react";
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
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { cn } from "@thinkrail/ui/utils";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import type { CustomEndpointsState } from "./CustomEndpointsSettings";
import { SettingsGroup } from "./SettingsGroup";

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

function ContextLimitControl({
	label,
	controlLabel = label,
	description,
	override,
	limits = MODEL_CONTEXT_WINDOW_LIMITS,
	disabled,
	testId,
	revision,
	onChange,
}: {
	label: string;
	controlLabel?: string;
	description: string;
	override: number | null | undefined;
	limits?: ModelContextWindowLimits;
	disabled: boolean;
	testId: string;
	revision: string;
	onChange: (override: number | null) => void;
}) {
	const t = useT();
	const range = tokenRange(t, limits);
	const id = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const restoreFocus = useRef<HTMLElement | null>(null);
	const skipBlurCommit = useRef(false);
	const initialDraft = {
		revision,
		custom: false,
		text: override != null && override !== MODEL_CONTEXT_WINDOW_LIMITS.max ? String(override) : "",
		submitted: null as string | null,
	};
	const [draft, setDraft] = useState(initialDraft);
	if (draft.revision !== revision) setDraft(initialDraft);

	useEffect(() => {
		const previous = restoreFocus.current;
		if (disabled || !previous) return;
		restoreFocus.current = null;
		if (document.activeElement === document.body && previous.isConnected) previous.focus();
	}, [disabled]);

	const selected = draft.custom
		? "custom"
		: override === undefined
			? null
			: (PRESETS.find((preset) => preset.override === override)?.id ?? "custom");
	const isCustomActive = selected === "custom";
	const text = draft.text.trim();
	const showError = text !== "" && !isContextWindowText(text, limits);

	const commitValue = () => {
		if (disabled || !isContextWindowText(text, limits) || text === draft.submitted) return false;
		const value = Number(text);
		if (value === override) return false;
		setDraft({ ...draft, submitted: text });
		onChange(value);
		return true;
	};

	return (
		<div
			data-testid={testId}
			data-context-override={override === undefined ? "mixed" : String(override)}
			className="flex flex-col gap-4"
		>
			<div className="flex flex-wrap items-center justify-between gap-12">
				<div className="flex min-w-0 flex-1 flex-col gap-2">
					<p className="tr-text-ui text-text-default">{label}</p>
					<p className="tr-text-metadata text-text-muted">{description}</p>
				</div>

				<div
					role="radiogroup"
					aria-label={t("settings.modelContext.controlLabel", { name: controlLabel })}
					className={cn(
						"inline-flex h-32 shrink-0 overflow-hidden rounded-sm bg-control-bg",
						showError && "ring-1 ring-feedback-error",
					)}
				>
					{PRESETS.filter((p) => p.id !== "custom").map((preset) => (
						<label
							key={preset.id}
							data-testid={`${testId}-${preset.id}`}
							onPointerDown={() => {
								if (document.activeElement === inputRef.current) skipBlurCommit.current = true;
							}}
							className={cn(
								"relative cursor-pointer transition-colors",
								disabled && "cursor-default",
							)}
						>
							<input
								type="radio"
								name={id}
								value={preset.id}
								checked={selected === preset.id}
								disabled={disabled}
								aria-label={t("settings.modelContext.presetFor", {
									preset: t(preset.label),
									name: controlLabel,
								})}
								className="peer sr-only inset-0"
								onChange={(event) => {
									if (disabled) return;
									restoreFocus.current = event.currentTarget;
									setDraft(initialDraft);
									onChange(preset.override);
								}}
							/>
							<span
								className={cn(
									"flex h-32 items-center px-12 tr-text-ui transition-colors",
									selected === preset.id
										? "rounded-sm bg-control-bg-selected text-text-default"
										: "text-text-muted hover:text-text-default",
									"peer-focus-visible:focus-ring-inset",
									"peer-disabled:text-control-disabled-text peer-disabled:hover:text-control-disabled-text",
								)}
							>
								{t(preset.label)}
							</span>
						</label>
					))}

					<div
						className={cn(
							"flex items-center",
							isCustomActive && "gap-8 rounded-sm bg-control-bg-selected",
						)}
					>
						<label
							data-testid={`${testId}-custom`}
							className={cn(
								"relative cursor-pointer transition-colors",
								disabled && "cursor-default",
							)}
						>
							<input
								type="radio"
								name={id}
								value="custom"
								checked={isCustomActive}
								disabled={disabled}
								aria-label={t("settings.modelContext.customFor", { name: controlLabel })}
								className="peer sr-only inset-0"
								onChange={() => {
									if (disabled) return;
									setDraft({ ...draft, custom: true });
									setTimeout(() => inputRef.current?.focus(), 0);
								}}
							/>
							<span
								className={cn(
									"flex h-32 items-center tr-text-ui transition-colors",
									isCustomActive
										? "pl-12 text-text-default"
										: "px-12 text-text-muted hover:text-text-default",
									"peer-focus-visible:focus-ring-inset",
									"peer-disabled:text-control-disabled-text peer-disabled:hover:text-control-disabled-text",
								)}
							>
								{t("settings.modelContext.preset.custom")}
							</span>
						</label>

						{isCustomActive ? (
							<input
								ref={inputRef}
								type="text"
								inputMode="numeric"
								value={draft.text}
								disabled={disabled}
								placeholder={range}
								aria-label={t("settings.modelContext.tokensFor", { name: controlLabel })}
								aria-invalid={showError}
								aria-describedby={showError ? `${id}-error` : undefined}
								data-testid={`${testId}-input`}
								data-settings-draft-input
								onChange={(event) =>
									setDraft({ ...draft, text: event.currentTarget.value, submitted: null })
								}
								onBlur={(event) => {
									const next = event.relatedTarget;
									const toSibling =
										next instanceof HTMLInputElement && next.type === "radio" && next.name === id;
									const skip = skipBlurCommit.current || toSibling;
									skipBlurCommit.current = false;
									if (!skip) commitValue();
								}}
								onKeyDown={(event) => {
									if (isImeComposing(event.nativeEvent)) return;
									if (event.key === "Enter") {
										event.preventDefault();
										if (commitValue()) restoreFocus.current = event.currentTarget;
									} else if (event.key === "Escape") {
										setDraft(initialDraft);
									}
								}}
								className="h-32 w-100 bg-transparent pr-8 tr-text-ui text-text-default placeholder:text-text-muted focus-visible:focus-ring-inset disabled:text-control-disabled-text"
							/>
						) : null}
					</div>
				</div>
			</div>
			{showError ? (
				<p id={`${id}-error`} className="text-right tr-text-metadata text-feedback-error">
					{t("settings.modelContext.invalid", { range })}
				</p>
			) : null}
		</div>
	);
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
			<Button variant="ghost" size="m" disabled={pending} onClick={onRetry}>
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
	onChange,
	onRetry,
}: {
	protocolVersion: number | null;
	settings: ModelContextSetting[] | null;
	customServers: ReadonlySet<string> | null;
	pending: boolean;
	failed: boolean;
	onChange: (target: ModelContextTarget, override: number | null) => void;
	onRetry: () => void;
}) {
	const t = useT();
	const [expanded, setExpanded] = useState(false);
	const rowsId = useId();
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

	return (
		<SettingsGroup title={t("settings.modelContext.title")} testId="settings-model-context">
			{failed ? (
				<ModelContextLoadFailed pending={pending} onRetry={onRetry} />
			) : rows === null ? (
				<div className="flex items-center justify-between gap-12 border-border-muted border-b py-12">
					<span className="tr-text-ui text-text-default">{t("settings.modelContext.global")}</span>
					<span className="tr-text-metadata text-text-muted">{t("common.loading")}</span>
				</div>
			) : rows.length === 0 ? (
				<div className="flex items-center justify-between gap-12 border-border-muted border-b py-12">
					<span className="tr-text-ui text-text-default">{t("settings.modelContext.global")}</span>
					<span className="tr-text-metadata text-text-muted">
						{t("settings.modelContext.noModels")}
					</span>
				</div>
			) : (
				<>
					<div className="flex flex-col gap-8 border-border-muted border-b py-12">
						{shared.length > 0 ? (
							<ContextLimitControl
								revision={revision}
								label={t("settings.modelContext.global")}
								description={sharedDescription}
								override={sharedOverride}
								disabled={pending}
								testId="context-limit-all"
								onChange={(override) => onChange("available", override)}
							/>
						) : null}
						<p className="rounded-sm bg-control-bg px-12 py-8 tr-text-metadata text-text-muted">
							{t("settings.modelContext.note")}
						</p>
					</div>

					<div className="flex flex-col border-border-muted border-b">
						<button
							type="button"
							onClick={() => setExpanded((value) => !value)}
							aria-expanded={expanded}
							aria-controls={rowsId}
							data-testid="model-context-customize"
							className="flex w-full items-start gap-8 py-12 text-left transition-colors focus-visible:focus-ring-inset"
						>
							<span className="flex-1 tr-text-ui text-text-default">
								{t("settings.modelContext.byModel")}
							</span>
							<span className="mt-2 shrink-0">
								{expanded ? (
									<RiArrowDownSLine className="size-20 text-text-muted" aria-hidden="true" />
								) : (
									<RiArrowRightSLine className="size-20 text-text-muted" aria-hidden="true" />
								)}
							</span>
						</button>
						{expanded && (
							<div id={rowsId} className="flex flex-col gap-16 pb-12">
								{rows.map((model) => (
									<ContextLimitControl
										key={`${model.provider}/${model.id}`}
										revision={String(model.override)}
										label={model.name}
										controlLabel={`${model.name} (${model.provider})`}
										description={
											model.override === null
												? t("settings.modelContext.modelDescriptionDefault", {
														provider: model.provider,
														tokens: tokens(t, model.contextWindow),
													})
												: t("settings.modelContext.modelDescription", {
														provider: model.provider,
														tokens: tokens(t, model.contextWindow),
													})
										}
										override={model.override}
										limits={modelContextLimitsFor(model.provider, protocolVersion)}
										disabled={pending}
										testId={`context-limit-${model.provider}-${model.id}`}
										onChange={(override) =>
											onChange({ provider: model.provider, id: model.id }, override)
										}
									/>
								))}
							</div>
						)}
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
		change: (target, contextWindow) => synchronize({ target, contextWindow }),
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
			onChange={(target, override) => {
				if (context.pending) return;
				void context.change(target, override);
			}}
		/>
	);
}
