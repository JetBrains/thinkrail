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
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";

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
	const input = useRef<HTMLInputElement>(null);
	const restoreFocus = useRef<HTMLElement | null>(null);
	const initialDraft = { revision, custom: false, text: override ? String(override) : "" };
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
	const parsed = Number(draft.text);
	const valid = /^\d+$/.test(draft.text) && isModelContextWindow(parsed);
	const canApply = !disabled && valid && parsed !== override;

	return (
		<div
			data-testid={testId}
			data-context-override={override === undefined ? "mixed" : String(override)}
			className="flex flex-col gap-8"
		>
			<div className="flex flex-wrap items-center justify-between gap-12">
				<div className="min-w-0">
					<p className="tr-text-ui text-text-default">{label}</p>
					<p className="tr-text-metadata text-text-muted">{description}</p>
				</div>
				<div
					role="radiogroup"
					aria-label={`Context window for ${controlLabel}`}
					className="inline-flex shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-control-border-default"
				>
					{PRESETS.map((preset) => (
						<label
							key={preset.id}
							data-testid={`${testId}-${preset.id}`}
							className="cursor-pointer"
						>
							<input
								type="radio"
								name={id}
								value={preset.id}
								checked={selected === preset.id}
								disabled={disabled}
								aria-label={`${preset.label} for ${controlLabel}`}
								className="peer sr-only"
								onChange={(event) => {
									if (disabled) return;
									if (preset.override === undefined) setDraft({ ...draft, custom: true });
									else {
										restoreFocus.current = event.currentTarget;
										setDraft(initialDraft);
										onChange(preset.override);
									}
								}}
							/>
							<span className="block bg-control-bg px-12 py-8 tr-text-ui text-text-muted hover:bg-control-bg-hovered peer-checked:bg-control-bg-selected peer-checked:text-text-default peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-primary peer-disabled:bg-control-disabled-bg peer-disabled:text-control-disabled-text">
								{preset.label}
							</span>
						</label>
					))}
				</div>
			</div>
			{selected === "custom" && (
				<form
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (!canApply) return;
						restoreFocus.current = input.current;
						onChange(parsed);
					}}
				>
					<div className="flex flex-wrap items-center gap-8">
						<input
							ref={input}
							type="number"
							min={MODEL_CONTEXT_WINDOW_LIMITS.min}
							max={MODEL_CONTEXT_WINDOW_LIMITS.max}
							step={1}
							inputMode="numeric"
							value={draft.text}
							disabled={disabled}
							aria-label={`Context tokens for ${controlLabel}`}
							aria-invalid={!valid}
							aria-describedby={!valid ? `${id}-error` : undefined}
							data-testid={`${testId}-input`}
							onChange={(event) => setDraft({ ...draft, text: event.currentTarget.value })}
							className="w-144 rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-8 py-4 tr-text-ui text-text-default outline-none focus:border-control-border-active focus-visible:ring-2 focus-visible:ring-primary disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text aria-invalid:border-feedback-error"
						/>
						<span className="tr-text-metadata text-text-muted">tokens</span>
						<Button
							type="submit"
							variant="outline"
							size="sm"
							disabled={!canApply}
							data-testid={`${testId}-apply`}
						>
							Apply
						</Button>
					</div>
					{!valid && (
						<p id={`${id}-error`} className="tr-text-metadata text-feedback-error">
							Enter a whole number within {RANGE} tokens.
						</p>
					)}
				</form>
			)}
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
		<div data-testid="settings-model-context" className="flex flex-col gap-12">
			<h3 className="tr-title-section text-text-default">GPT context window</h3>
			{failed ? (
				<div className="flex items-center gap-8" role="alert">
					<p className="tr-text-ui text-text-muted">Couldn't load pi context settings.</p>
					<Button variant="ghost" size="sm" disabled={pending} onClick={onRetry}>
						Retry
					</Button>
				</div>
			) : settings === null ? (
				<p className="tr-text-metadata text-text-muted" role="status">
					Loading context settings…
				</p>
			) : settings.length === 0 ? (
				<p className="tr-text-metadata text-text-muted">
					No GPT models limited to {tokens(MODEL_CONTEXT_WINDOW_LIMITS.min)} tokens are available.
				</p>
			) : (
				<>
					{shared.length > 0 && (
						<ContextLimitControl
							revision={revision}
							label="All supported GPT models"
							description={sharedDescription}
							override={sharedOverride}
							disabled={pending}
							testId="context-limit-all"
							onChange={(override) => onChange("available", override)}
						/>
					)}
					<Button
						variant="ghost"
						size="sm"
						className="w-fit gap-4"
						data-testid="model-context-customize"
						aria-expanded={expanded}
						aria-controls={rowsId}
						onClick={() => setExpanded((value) => !value)}
					>
						{expanded ? (
							<RiArrowDownSLine className="size-16" aria-hidden="true" />
						) : (
							<RiArrowRightSLine className="size-16" aria-hidden="true" />
						)}
						Customize by model and provider
					</Button>
					{expanded && (
						<div id={rowsId} className="flex flex-col gap-16 border-border-muted border-t pt-12">
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
				</>
			)}
			<div className="flex flex-col gap-4 tr-text-metadata text-text-muted">
				<p>
					Default keeps pi's catalog limit. Custom accepts {RANGE} tokens; your provider and account
					must support the selected limit, and larger contexts may increase cost or quota usage.
				</p>
				<p>
					Shared with pi CLI through models.json. New chats use this limit; restart the host to
					update existing chats.
				</p>
			</div>
		</div>
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
