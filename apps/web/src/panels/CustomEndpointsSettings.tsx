import {
	RiAddLine as Plus,
	RiSearchLine as Search,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import {
	CUSTOM_ENDPOINTS_PROTOCOL_VERSION,
	type CustomEndpoint,
	type CustomEndpointModel,
} from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { formatContext } from "@/chat/modelPicker";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { ConfirmDialog } from "./ConfirmDialog";
import {
	addManualModel,
	addressMoved,
	applyPreset,
	canSave,
	draftParams,
	type EndpointDraft,
	editEndpointDraft,
	LOCAL_SERVER_PRESETS,
	mergeProbe,
	newEndpointDraft,
	probeFailureText,
	probeTarget,
} from "./customEndpointDraft";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsSwitch } from "./SettingsSwitch";

const INPUT_CLASS =
	"h-32 w-full min-w-0 rounded-sm border border-control-border-default bg-control-bg px-8 tr-text-ui text-text-default outline-none transition-colors placeholder:text-text-muted focus:border-control-border-active disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text";

type Status = { tone: "ok" | "error"; text: string } | null;

function supported(protocolVersion: number | null): boolean {
	return protocolVersion !== null && protocolVersion >= CUSTOM_ENDPOINTS_PROTOCOL_VERSION;
}

function Field({
	label,
	htmlFor,
	children,
}: {
	label: string;
	htmlFor: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-4">
			<label htmlFor={htmlFor} className="tr-title-compact text-text-default">
				{label}
			</label>
			{children}
		</div>
	);
}

function ModelFacts({ model }: { model: CustomEndpointModel }) {
	const t = useT();
	const facts = [
		model.contextWindow === null
			? null
			: t("settings.customEndpoints.factContext", { tokens: formatContext(model.contextWindow) }),
		model.reasoning ? t("settings.customEndpoints.factThinking") : null,
		model.vision ? t("settings.customEndpoints.factImages") : null,
		model.tools === true ? t("settings.customEndpoints.factTools") : null,
	].filter((fact): fact is string => fact !== null);
	if (facts.length === 0 && model.tools !== false) return null;
	return (
		<span className="truncate tr-text-metadata text-text-muted">
			{facts.join(" · ")}
			{model.tools === false ? (
				<span data-testid="custom-endpoints-no-tools" className="text-feedback-warning">
					{facts.length > 0 ? " · " : ""}
					{t("settings.customEndpoints.factNoTools")}
				</span>
			) : null}
		</span>
	);
}

function EndpointDialog({
	initial,
	onClose,
	onSaved,
}: {
	initial: EndpointDraft;
	onClose: () => void;
	onSaved: (endpoints: CustomEndpoint[]) => void;
}) {
	const t = useT();
	const id = useId();
	const [draft, setDraft] = useState(initial);
	const [manualId, setManualId] = useState("");
	const [probing, setProbing] = useState(false);
	const [saving, setSaving] = useState(false);
	const [status, setStatus] = useState<Status>(null);
	const busy = probing || saving;
	const autoDetected = useRef(false);

	const detect = useCallback(
		(current: EndpointDraft) => {
			setProbing(true);
			setStatus(null);
			return getTransport()
				.request("customEndpoints.probe", { baseUrl: current.baseUrl, ...probeTarget(current) })
				.then((probe) => {
					if (!probe.ok) {
						setStatus({ tone: "error", text: probeFailureText(t, probe) });
						return;
					}
					setDraft((latest) => mergeProbe(latest, probe));
					setStatus({
						tone: "ok",
						text: t("settings.customEndpoints.found", { count: probe.models.length }),
					});
				})
				.catch((error: unknown) => setStatus({ tone: "error", text: errorText(error) }))
				.finally(() => setProbing(false));
		},
		[t],
	);

	useEffect(() => {
		if (autoDetected.current || !initial.id) return;
		autoDetected.current = true;
		void detect(initial);
	}, [detect, initial]);

	const save = () => {
		if (!canSave(draft)) return;
		setSaving(true);
		setStatus(null);
		void getTransport()
			.request("customEndpoints.save", draftParams(draft))
			.then((endpoints) => {
				onSaved(endpoints);
				onClose();
			})
			.catch((error: unknown) => setStatus({ tone: "error", text: errorText(error) }))
			.finally(() => setSaving(false));
	};

	const addManual = () => {
		setDraft((current) => addManualModel(current, manualId));
		setManualId("");
	};

	return (
		<Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
			<DialogContent
				data-testid="custom-endpoints-dialog"
				className="flex max-h-[85vh] max-w-[36rem] flex-col"
			>
				<DialogHeader>
					<DialogTitle>
						{draft.id
							? t("settings.customEndpoints.editTitle")
							: t("settings.customEndpoints.addTitle")}
					</DialogTitle>
					<DialogDescription>{t("settings.customEndpoints.dialogDescription")}</DialogDescription>
				</DialogHeader>
				<div className="-mx-16 flex min-h-0 flex-1 flex-col gap-12 overflow-y-auto px-16">
					<Field label={t("settings.customEndpoints.name")} htmlFor={`${id}-name`}>
						<input
							id={`${id}-name`}
							data-testid="custom-endpoints-name"
							className={INPUT_CLASS}
							value={draft.name}
							disabled={busy}
							onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
						/>
					</Field>
					<Field label={t("settings.customEndpoints.url")} htmlFor={`${id}-url`}>
						<input
							id={`${id}-url`}
							data-testid="custom-endpoints-url"
							className={cn(INPUT_CLASS, "tr-code-text")}
							value={draft.baseUrl}
							disabled={busy}
							spellCheck={false}
							placeholder={t("settings.customEndpoints.urlPlaceholder")}
							onChange={(event) => setDraft({ ...draft, baseUrl: event.currentTarget.value })}
						/>
						{addressMoved(draft) ? (
							<p
								data-testid="custom-endpoints-address-moved"
								className="tr-text-metadata text-feedback-warning"
							>
								{t("settings.customEndpoints.addressMoved")}
							</p>
						) : null}
						<div className="flex flex-wrap items-center gap-4">
							<span className="tr-text-metadata text-text-muted">
								{t("settings.customEndpoints.local")}
							</span>
							{LOCAL_SERVER_PRESETS.map((preset) => (
								<Button
									key={preset.name}
									variant="outline"
									size="s"
									data-testid="custom-endpoints-preset"
									data-preset={preset.name}
									disabled={busy}
									selected={draft.baseUrl === preset.baseUrl}
									onClick={() => setDraft(applyPreset(draft, preset))}
								>
									{preset.name}
								</Button>
							))}
						</div>
					</Field>
					<Field label={t("settings.customEndpoints.apiKey")} htmlFor={`${id}-key`}>
						<div className="flex items-center gap-8">
							<input
								id={`${id}-key`}
								data-testid="custom-endpoints-key"
								type="password"
								autoComplete="new-password"
								className={INPUT_CLASS}
								value={draft.apiKey}
								disabled={busy || draft.removeKey}
								placeholder={
									draft.removeKey
										? t("settings.customEndpoints.apiKeyRemoved")
										: draft.hasSavedKey
											? t("settings.customEndpoints.apiKeySaved")
											: t("settings.customEndpoints.apiKeyOptional")
								}
								onChange={(event) => setDraft({ ...draft, apiKey: event.currentTarget.value })}
							/>
							{draft.hasSavedKey ? (
								<Button
									variant="ghost"
									size="m"
									data-testid="custom-endpoints-remove-key"
									disabled={busy}
									selected={draft.removeKey}
									onClick={() => setDraft({ ...draft, removeKey: !draft.removeKey, apiKey: "" })}
								>
									{draft.removeKey
										? t("settings.customEndpoints.keepKey")
										: t("settings.customEndpoints.removeKey")}
								</Button>
							) : null}
						</div>
					</Field>
					<div className="flex flex-col gap-4">
						<div className="flex items-center justify-between gap-8">
							<span className="tr-title-compact text-text-default">
								{t("settings.customEndpoints.models")}
							</span>
							<Button
								variant="outline"
								size="m"
								iconLeft={Search}
								loading={probing}
								data-testid="custom-endpoints-detect"
								disabled={busy || !draft.baseUrl.trim()}
								onClick={() => void detect(draft)}
							>
								{t("settings.customEndpoints.detect")}
							</Button>
						</div>
						{draft.models.length > 0 ? (
							<ul className="flex flex-col" data-testid="custom-endpoints-models">
								{draft.models.map((model, index) => (
									<li
										key={model.id}
										data-testid="custom-endpoints-row"
										data-model={model.id}
										className={cn(
											"flex items-center gap-8 py-8",
											index > 0 && "border-border-muted border-t",
										)}
									>
										<span className="flex min-w-0 flex-1 flex-col">
											<span
												className={cn(
													"truncate tr-text-ui",
													model.selected ? "text-text-default" : "text-text-muted",
												)}
												title={model.id}
											>
												{model.id}
											</span>
											<ModelFacts model={model} />
										</span>
										<SettingsSwitch
											checked={model.selected}
											disabled={busy}
											label={t("settings.customEndpoints.use", { name: model.id })}
											testId="custom-endpoints-use"
											onChange={(selected) =>
												setDraft((current) => ({
													...current,
													models: current.models.map((row) =>
														row.id === model.id ? { ...row, selected } : row,
													),
												}))
											}
										/>
									</li>
								))}
							</ul>
						) : null}
						<div className="flex items-center gap-8">
							<input
								data-testid="custom-endpoints-manual"
								aria-label={t("settings.customEndpoints.manualLabel")}
								className={cn(INPUT_CLASS, "tr-code-text")}
								value={manualId}
								disabled={busy}
								spellCheck={false}
								placeholder={t("settings.customEndpoints.manualPlaceholder")}
								onChange={(event) => setManualId(event.currentTarget.value)}
								onKeyDown={(event) => {
									if (event.key !== "Enter") return;
									event.preventDefault();
									addManual();
								}}
							/>
							<Button
								variant="outline"
								size="m"
								iconLeft={Plus}
								data-testid="custom-endpoints-manual-add"
								disabled={busy || !manualId.trim()}
								onClick={addManual}
							>
								{t("common.add")}
							</Button>
						</div>
					</div>
					{status ? (
						<p
							role={status.tone === "error" ? "alert" : "status"}
							data-testid="custom-endpoints-status"
							data-tone={status.tone}
							className={cn(
								"tr-text-metadata",
								status.tone === "error" ? "text-feedback-error" : "text-text-muted",
							)}
						>
							{status.text}
						</p>
					) : null}
				</div>
				<DialogFooter>
					<Button variant="outline" disabled={busy} onClick={onClose}>
						{t("common.cancel")}
					</Button>
					<Button
						data-testid="custom-endpoints-save"
						loading={saving}
						disabled={busy || !canSave(draft)}
						onClick={save}
					>
						{t("common.save")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export interface CustomEndpointsState {
	endpoints: CustomEndpoint[] | null;
	failed: boolean;
	load: () => Promise<void>;
	replace: (next: CustomEndpoint[]) => void;
}

export function useCustomEndpoints(): CustomEndpointsState | null {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const providerVersion = useAppStore((state) => state.providerVersion);
	const [endpoints, setEndpoints] = useState<CustomEndpoint[] | null>(null);
	const [failed, setFailed] = useState(false);
	const sequence = useRef(0);

	const load = useCallback(async () => {
		if (!supported(protocolVersion)) return;
		const current = ++sequence.current;
		try {
			const next = await getTransport().request("customEndpoints.list", {});
			if (current !== sequence.current) return;
			setEndpoints(next);
			setFailed(false);
		} catch {
			if (current === sequence.current) setFailed(true);
		}
	}, [protocolVersion]);

	useEffect(() => {
		void load();
	}, [load, providerVersion]);

	const replace = useCallback((next: CustomEndpoint[]) => {
		sequence.current++;
		setEndpoints(next);
	}, []);

	if (!supported(protocolVersion)) return null;
	return { endpoints, failed, load, replace };
}

export function CustomEndpointsSettings({
	state: { endpoints, failed, load, replace },
}: {
	state: CustomEndpointsState;
}) {
	const t = useT();
	const [dialog, setDialog] = useState<EndpointDraft | null>(null);
	const [removing, setRemoving] = useState<CustomEndpoint | null>(null);

	const remove = async (endpoint: CustomEndpoint) => {
		try {
			replace(await getTransport().request("customEndpoints.remove", { id: endpoint.id }));
		} catch (error) {
			toast.error(errorText(error), t("settings.customEndpoints.removeFailed"));
		}
	};

	return (
		<SettingsGroup
			title={t("settings.customEndpoints.title")}
			description={t("settings.customEndpoints.description")}
			testId="settings-custom-endpoints"
		>
			{failed ? (
				<div className="flex items-center gap-8 border-border-muted border-b py-12" role="alert">
					<p className="tr-text-ui text-text-muted">{t("settings.customEndpoints.loadFailed")}</p>
					<Button variant="ghost" size="m" onClick={() => void load()}>
						{t("common.retry")}
					</Button>
				</div>
			) : (
				(endpoints ?? []).map((endpoint) => (
					<div
						key={endpoint.id}
						data-row
						data-testid="custom-endpoints-endpoint"
						data-endpoint={endpoint.id}
						className="flex items-center gap-8 border-border-muted border-b py-12"
					>
						<div className="flex min-w-0 flex-1 flex-col gap-2">
							<span className="truncate tr-text-ui text-text-default">{endpoint.name}</span>
							<span className="truncate tr-text-metadata text-text-muted" title={endpoint.baseUrl}>
								{t("settings.customEndpoints.endpointSummary", {
									url: endpoint.baseUrl,
									count: endpoint.models.length,
								})}
							</span>
						</div>
						<Button
							variant="ghost"
							size="m"
							data-testid="custom-endpoints-edit"
							aria-label={t("settings.customEndpoints.editLabel", { name: endpoint.name })}
							onClick={() => setDialog(editEndpointDraft(endpoint))}
						>
							{t("common.edit")}
						</Button>
						<IconButton
							icon={Trash2}
							label={t("settings.customEndpoints.removeLabel", { name: endpoint.name })}
							data-testid="custom-endpoints-remove"
							onClick={() => setRemoving(endpoint)}
						/>
					</div>
				))
			)}
			<div className="py-12">
				<Button
					variant="outline"
					size="m"
					iconLeft={Plus}
					data-testid="custom-endpoints-add"
					onClick={() => setDialog(newEndpointDraft())}
				>
					{t("settings.customEndpoints.add")}
				</Button>
			</div>
			{dialog ? (
				<EndpointDialog initial={dialog} onClose={() => setDialog(null)} onSaved={replace} />
			) : null}
			<ConfirmDialog
				open={removing !== null}
				onOpenChange={(open) => !open && setRemoving(null)}
				title={t("settings.customEndpoints.removeTitle", { name: removing?.name ?? "" })}
				description={t("settings.customEndpoints.removeDescription")}
				confirmLabel={t("common.remove")}
				destructive
				confirmTestId="custom-endpoints-remove-confirm"
				onConfirm={() => {
					if (removing) void remove(removing);
				}}
			/>
		</SettingsGroup>
	);
}
