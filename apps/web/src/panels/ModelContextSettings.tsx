import { RiArrowDownSLine, RiArrowRightSLine } from "@remixicon/react";
import {
	CONTEXT_WINDOW_SETTINGS_PROTOCOL_VERSION,
	isModelContextWindow,
	isSharedModelContextTarget,
	MODEL_CONTEXT_WINDOW_LIMITS,
	type ModelContextSetting,
	type ModelContextTarget,
	type WsMethodMap,
} from "@thinkrail/contracts";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { SettingsGroup } from "./SettingsGroup";

const PRESETS = [
	{ id: "default", label: "Default", override: null },
	{ id: "1m", label: "1M", override: MODEL_CONTEXT_WINDOW_LIMITS.max },
	{ id: "custom", label: "Custom", override: undefined },
] as const;

const tokens = (value: number) => value.toLocaleString("en-US");
const RANGE = `${tokens(MODEL_CONTEXT_WINDOW_LIMITS.min)}–${tokens(MODEL_CONTEXT_WINDOW_LIMITS.max)}`;

function supported(protocolVersion: number | null): boolean {
	return protocolVersion !== null && protocolVersion >= CONTEXT_WINDOW_SETTINGS_PROTOCOL_VERSION;
}

function isCustomText(text: string): boolean {
	return /^\d+$/.test(text) && isModelContextWindow(Number(text));
}

function ContextLimitControl({
	label,
	controlLabel = label,
	description,
	override,
	disabled,
	testId,
	revision,
	onChange,
}: {
	label: string;
	controlLabel?: string;
	description: string;
	override: number | null | undefined;
	disabled: boolean;
	testId: string;
	revision: string;
	onChange: (override: number | null) => void;
}) {
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
	const showError = text !== "" && !isCustomText(text);

	const commitValue = () => {
		if (disabled || !isCustomText(text) || text === draft.submitted) return false;
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
					aria-label={`Context window for ${controlLabel}`}
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
								aria-label={`${preset.label} for ${controlLabel}`}
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
									"peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-primary",
									"peer-disabled:text-control-disabled-text peer-disabled:hover:text-control-disabled-text",
								)}
							>
								{preset.label}
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
								aria-label={`Custom for ${controlLabel}`}
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
									"peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-primary",
									"peer-disabled:text-control-disabled-text peer-disabled:hover:text-control-disabled-text",
								)}
							>
								Custom
							</span>
						</label>

						{isCustomActive ? (
							<input
								ref={inputRef}
								type="text"
								inputMode="numeric"
								value={draft.text}
								disabled={disabled}
								placeholder={RANGE}
								aria-label={`Context tokens for ${controlLabel}`}
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
									if (event.key === "Enter") {
										event.preventDefault();
										if (commitValue()) restoreFocus.current = event.currentTarget;
									} else if (event.key === "Escape") {
										setDraft(initialDraft);
									}
								}}
								className="h-32 w-100 bg-transparent pr-8 tr-text-ui text-text-default outline-none placeholder:text-text-muted disabled:text-control-disabled-text"
							/>
						) : null}
					</div>
				</div>
			</div>
			{showError ? (
				<p id={`${id}-error`} className="text-right tr-text-metadata text-feedback-error">
					Enter a number within {RANGE} tokens.
				</p>
			) : null}
		</div>
	);
}

export function ModelContextControls({
	protocolVersion,
	settings,
	pending,
	failed,
	onChange,
	onRetry,
}: {
	protocolVersion: number | null;
	settings: ModelContextSetting[] | null;
	pending: boolean;
	failed: boolean;
	onChange: (target: ModelContextTarget, override: number | null) => void;
	onRetry: () => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const rowsId = useId();
	if (!supported(protocolVersion)) return null;
	const shared = settings?.filter(isSharedModelContextTarget) ?? [];
	const external = (settings?.length ?? 0) - shared.length;
	const first = shared[0]?.override;
	const sharedOverride = shared.every((model) => model.override === first) ? first : undefined;
	const revision = JSON.stringify(
		settings?.map((model) => [model.provider, model.id, model.override]),
	);
	const sharedDescription = [
		sharedOverride === undefined
			? "Customized by model"
			: `${shared.length} available model${shared.length === 1 ? "" : "s"}`,
		...(external > 0 ? [`${external} kept at a limit set outside the ${RANGE} range`] : []),
	].join(" · ");

	return (
		<SettingsGroup title="GPT context window" testId="settings-model-context">
			{failed ? (
				<div className="flex items-center gap-8 border-border-muted border-b py-12" role="alert">
					<p className="tr-text-ui text-text-muted">Couldn't load pi context settings.</p>
					<Button variant="ghost" size="sm" disabled={pending} onClick={onRetry}>
						Retry
					</Button>
				</div>
			) : settings === null ? (
				<div className="flex items-center justify-between gap-12 border-border-muted border-b py-12">
					<span className="tr-text-ui text-text-default">Global</span>
					<span className="tr-text-metadata text-text-muted">Loading…</span>
				</div>
			) : settings.length === 0 ? (
				<div className="flex items-center justify-between gap-12 border-border-muted border-b py-12">
					<span className="tr-text-ui text-text-default">Global</span>
					<span className="tr-text-metadata text-text-muted">No eligible models</span>
				</div>
			) : (
				<>
					<div className="flex flex-col gap-8 border-border-muted border-b py-12">
						{shared.length > 0 ? (
							<ContextLimitControl
								revision={revision}
								label="Global"
								description={sharedDescription}
								override={sharedOverride}
								disabled={pending}
								testId="context-limit-all"
								onChange={(override) => onChange("available", override)}
							/>
						) : null}
						<p className="rounded-sm bg-control-bg px-12 py-8 tr-text-metadata text-text-muted">
							Default uses the model's catalog limit. Larger contexts may increase cost or quota
							usage. Settings sync with pi CLI via models.json. New chats use updated limits;
							existing chats may need a host restart.
						</p>
					</div>

					<div className="flex flex-col border-border-muted border-b">
						<button
							type="button"
							onClick={() => setExpanded((value) => !value)}
							aria-expanded={expanded}
							aria-controls={rowsId}
							data-testid="model-context-customize"
							className="flex w-full items-start gap-8 py-12 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary"
						>
							<span className="flex-1 tr-text-ui text-text-default">By each model</span>
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
								{settings.map((model) => (
									<ContextLimitControl
										key={`${model.provider}/${model.id}`}
										revision={String(model.override)}
										label={model.name}
										controlLabel={`${model.name} (${model.provider})`}
										description={`${model.provider} · ${tokens(model.contextWindow)} tokens${model.override === null ? " (pi default)" : ""}`}
										override={model.override}
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

export function ModelContextSettings() {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const providerVersion = useAppStore((state) => state.providerVersion);
	const models = useAppStore((state) => state.models);
	const [settings, setSettings] = useState<ModelContextSetting[] | null>(null);
	const [pending, setPending] = useState(true);
	const [failed, setFailed] = useState(false);
	const sequence = useRef(0);

	const synchronize = useCallback(
		async (change?: WsMethodMap["model.setContextWindow"]["params"]) => {
			if (!supported(protocolVersion)) return;
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
				toast.error("Couldn't update pi context settings. Retry to check the saved configuration.");
			if (current !== sequence.current) return;
			if (next === undefined) setFailed(true);
			else if (providerVersion === useAppStore.getState().providerVersion) {
				setSettings(next);
				setFailed(false);
			}
			setPending(false);
		},
		[protocolVersion, providerVersion],
	);

	useEffect(() => {
		void synchronize();
		return () => {
			sequence.current++;
		};
	}, [models, synchronize]);

	return (
		<ModelContextControls
			protocolVersion={protocolVersion}
			settings={settings}
			pending={pending}
			failed={failed}
			onRetry={() => void synchronize()}
			onChange={(target, override) => {
				if (pending) return;
				void synchronize({ target, contextWindow: override });
			}}
		/>
	);
}
