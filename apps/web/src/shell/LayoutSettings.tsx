import {
	RiCheckLine as Check,
	RiLayoutTop2Line as LayoutPanelTop,
	RiPencilLine as Pencil,
	RiAddLine as Plus,
	RiDeleteBin6Line as Trash2,
	RiCloseLine as X,
} from "@remixicon/react";
import {
	DEFAULT_CONFIG,
	type LayoutPreset,
	type LayoutSettings as LayoutSettingsValue,
} from "@thinkrail/contracts";
import { useEffect, useMemo, useState } from "react";
import { randomId } from "../lib";
import { ConfirmDialog } from "../panels/ConfirmDialog";
import { toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import {
	applyLayoutPreset,
	BUILTIN_LAYOUT_PRESETS,
	captureLayoutPreset,
	minimumBottomGroupLimit,
	minimumSideGroupLimit,
	resolveLayoutPreset,
} from "./layout";
import { commitWorkspaceLayout } from "./layoutState";

const BUILTIN_PRESET_IDS = new Set(BUILTIN_LAYOUT_PRESETS.map((preset) => preset.id));
const MAX_CUSTOM_PRESETS = 32;

async function updateLayoutSettings(layout: LayoutSettingsValue): Promise<void> {
	try {
		await getTransport().request("settings.update", { config: { layout } });
	} catch (error) {
		toast.error(errorText(error), "Couldn't save layout settings");
		throw error;
	}
}

export function LayoutSettings() {
	const settings = useAppStore((state) => state.layoutSettings);
	const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);
	const document = useAppStore((state) =>
		activeWorkspaceId ? state.layoutDocumentsByWorkspace[activeWorkspaceId] : undefined,
	);
	const [name, setName] = useState("");
	const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
	const [sideLimit, setSideLimit] = useState(String(settings.maxSideGroups));
	const [bottomLimit, setBottomLimit] = useState(String(settings.maxBottomGroups));
	const [applying, setApplying] = useState<LayoutPreset | null>(null);
	const [saving, setSaving] = useState(false);
	useEffect(() => setSideLimit(String(settings.maxSideGroups)), [settings.maxSideGroups]);
	useEffect(() => setBottomLimit(String(settings.maxBottomGroups)), [settings.maxBottomGroups]);
	const presets = useMemo(
		() => [
			...BUILTIN_LAYOUT_PRESETS,
			...settings.customPresets.filter((preset) => !BUILTIN_PRESET_IDS.has(preset.id)),
		],
		[settings.customPresets],
	);
	const selected = resolveLayoutPreset(settings.defaultPresetId, settings.customPresets);
	const minimumSideLimit = Math.max(
		minimumSideGroupLimit(selected),
		...settings.customPresets.map(minimumSideGroupLimit),
	);
	const minimumBottomLimit = Math.max(
		minimumBottomGroupLimit(selected),
		...settings.customPresets.map(minimumBottomGroupLimit),
	);

	const saveSettings = async (next: LayoutSettingsValue): Promise<boolean> => {
		setSaving(true);
		try {
			await updateLayoutSettings(next);
			return true;
		} catch {
			return false;
		} finally {
			setSaving(false);
		}
	};

	const apply = (preset: LayoutPreset) => {
		if (!activeWorkspaceId || !document) return;
		const requiredSideLimit = Math.max(settings.maxSideGroups, minimumSideGroupLimit(preset));
		const requiredBottomLimit = Math.max(settings.maxBottomGroups, minimumBottomGroupLimit(preset));
		void (async () => {
			if (
				(requiredSideLimit !== settings.maxSideGroups ||
					requiredBottomLimit !== settings.maxBottomGroups) &&
				!(await saveSettings({
					...settings,
					maxSideGroups: requiredSideLimit,
					maxBottomGroups: requiredBottomLimit,
				}))
			) {
				return;
			}
			const latestDocument = useAppStore.getState().layoutDocumentsByWorkspace[activeWorkspaceId];
			if (!latestDocument) return;
			await commitWorkspaceLayout(activeWorkspaceId, applyLayoutPreset(latestDocument, preset));
			toast.success(`${preset.name} layout applied`);
		})().catch(() => {});
	};

	const commitRename = (presetId: string) => {
		if (saving) return;
		const nextName = renaming?.id === presetId ? renaming.name.trim() : "";
		if (!nextName) return;
		void saveSettings({
			...settings,
			customPresets: settings.customPresets.map((preset) =>
				preset.id === presetId ? { ...preset, name: nextName } : preset,
			),
		}).then((saved) => {
			if (saved) setRenaming(null);
		});
	};

	return (
		<div className="space-y-24">
			<header>
				<h2 className="tr-title-section text-text-default">Layout</h2>
				<p className="mt-4 max-w-[42rem] tr-text-ui text-text-muted">
					Choose how new workspaces begin, save reusable arrangements, and control auxiliary group
					density. Existing workspaces change only when you apply a preset.
				</p>
			</header>

			<section className="space-y-8">
				<div>
					<h3 className="tr-title-section text-text-default">Default preset</h3>
					<p className="tr-text-metadata text-text-muted">
						New workspaces currently use {selected.name}.
					</p>
				</div>
				<div className="grid gap-8 sm:grid-cols-2">
					{presets.map((preset) => {
						const isStoredDefault = preset.id === settings.defaultPresetId;
						const isEffectiveDefault = preset.id === selected.id;
						const custom =
							!BUILTIN_PRESET_IDS.has(preset.id) &&
							settings.customPresets.some((candidate) => candidate.id === preset.id);
						return (
							<div
								key={preset.id}
								data-testid="layout-preset"
								data-default={isEffectiveDefault}
								className="rounded-[var(--radius-md)] border border-border-default bg-container-elevated-bg p-12"
							>
								<div className="flex items-start gap-8">
									<LayoutPanelTop className="mt-2 size-16 shrink-0 text-primary" />
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-4">
											{renaming?.id === preset.id ? (
												<input
													value={renaming.name}
													onChange={(event) =>
														setRenaming({ id: preset.id, name: event.target.value })
													}
													onKeyDown={(event) => {
														if (event.key === "Enter") commitRename(preset.id);
														if (event.key === "Escape") setRenaming(null);
													}}
													aria-label={`Rename ${preset.name}`}
													maxLength={200}
													className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-4 py-2 tr-text-ui text-text-default outline-none focus:ring-2 focus:ring-primary"
												/>
											) : (
												<span className="truncate tr-text-ui text-text-default">{preset.name}</span>
											)}
											{isEffectiveDefault ? (
												<span className="inline-flex items-center gap-2 rounded-full bg-primary-subtle px-4 py-2 tr-text-label-pill text-primary">
													<Check className="size-12" /> {isStoredDefault ? "Default" : "Fallback"}
												</span>
											) : null}
										</div>
										<p className="mt-2 tr-text-metadata text-text-muted">
											{preset.left.groups.length} left · {preset.right.groups.length} right ·{" "}
											{preset.bottom.groups.length} bottom groups
										</p>
									</div>
								</div>
								<div className="mt-12 flex flex-wrap gap-4">
									<button
										type="button"
										disabled={isStoredDefault || saving}
										onClick={() =>
											void saveSettings({
												...settings,
												defaultPresetId: preset.id,
												maxSideGroups: Math.max(
													settings.maxSideGroups,
													minimumSideGroupLimit(preset),
												),
												maxBottomGroups: Math.max(
													settings.maxBottomGroups,
													minimumBottomGroupLimit(preset),
												),
											})
										}
										className="rounded-[var(--radius-sm)] border border-border-default px-8 py-4 tr-text-metadata text-text-default hover:bg-control-bg-hovered disabled:text-control-disabled-text"
									>
										Set default
									</button>
									<button
										type="button"
										disabled={saving || !activeWorkspaceId || !document}
										onClick={() => setApplying(preset)}
										className="rounded-[var(--radius-sm)] bg-control-primary-bg px-8 py-4 tr-text-metadata text-control-primary-text hover:bg-control-primary-bg-hovered disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text"
									>
										Apply now…
									</button>
									{custom ? (
										<div className="ml-auto flex items-center gap-2">
											{renaming?.id === preset.id ? (
												<>
													<button
														type="button"
														aria-label={`Save ${preset.name} name`}
														disabled={!renaming.name.trim() || saving}
														onClick={() => commitRename(preset.id)}
														className="rounded-[var(--radius-sm)] p-4 text-primary hover:bg-control-bg-hovered disabled:text-control-disabled-text"
													>
														<Check className="size-14" />
													</button>
													<button
														type="button"
														aria-label={`Cancel renaming ${preset.name}`}
														onClick={() => setRenaming(null)}
														className="rounded-[var(--radius-sm)] p-4 text-text-muted hover:bg-control-bg-hovered"
													>
														<X className="size-14" />
													</button>
												</>
											) : (
												<button
													type="button"
													aria-label={`Rename ${preset.name}`}
													disabled={saving}
													onClick={() => setRenaming({ id: preset.id, name: preset.name })}
													className="rounded-[var(--radius-sm)] p-4 text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
												>
													<Pencil className="size-14" />
												</button>
											)}
											<button
												type="button"
												aria-label={`Delete ${preset.name}`}
												disabled={saving}
												onClick={() => {
													const customPresets = settings.customPresets.filter(
														(candidate) => candidate.id !== preset.id,
													);
													const defaultPresetId =
														settings.defaultPresetId === preset.id
															? DEFAULT_CONFIG.layout.defaultPresetId
															: settings.defaultPresetId;
													const nextDefault = resolveLayoutPreset(defaultPresetId, customPresets);
													void saveSettings({
														...settings,
														customPresets,
														defaultPresetId,
														maxSideGroups: Math.max(
															settings.maxSideGroups,
															minimumSideGroupLimit(nextDefault),
															...customPresets.map(minimumSideGroupLimit),
														),
														maxBottomGroups: Math.max(
															settings.maxBottomGroups,
															minimumBottomGroupLimit(nextDefault),
															...customPresets.map(minimumBottomGroupLimit),
														),
													});
												}}
												className="rounded-[var(--radius-sm)] p-4 text-text-muted hover:bg-feedback-error-subtle hover:text-feedback-error"
											>
												<Trash2 className="size-14" />
											</button>
										</div>
									) : null}
								</div>
							</div>
						);
					})}
				</div>
			</section>

			<section className="space-y-8 border-border-default border-t pt-16">
				<div>
					<h3 className="tr-title-section text-text-default">Save current arrangement</h3>
					<p className="tr-text-metadata text-text-muted">
						Workspace resources are omitted; the preset keeps topology, proportions, folds, and tool
						placement.
					</p>
				</div>
				<div data-testid="layout-preset-save-row" className="flex max-w-lg gap-8">
					<input
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="Preset name"
						aria-label="Custom preset name"
						maxLength={200}
						className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-8 py-4 tr-text-ui text-text-default outline-none placeholder:text-text-subtle focus:ring-2 focus:ring-primary"
					/>
					<button
						type="button"
						disabled={
							!document ||
							!name.trim() ||
							settings.customPresets.length >= MAX_CUSTOM_PRESETS ||
							saving
						}
						title={
							settings.customPresets.length >= MAX_CUSTOM_PRESETS
								? `Custom presets are limited to ${MAX_CUSTOM_PRESETS}.`
								: undefined
						}
						onClick={() => {
							if (!document || !name.trim()) return;
							const preset = captureLayoutPreset(document, randomId("preset"), name.trim());
							const requiredSideLimit = Math.max(
								settings.maxSideGroups,
								minimumSideGroupLimit(preset),
							);
							const requiredBottomLimit = Math.max(
								settings.maxBottomGroups,
								minimumBottomGroupLimit(preset),
							);
							void saveSettings({
								...settings,
								maxSideGroups: requiredSideLimit,
								maxBottomGroups: requiredBottomLimit,
								customPresets: [...settings.customPresets, preset],
							}).then((saved) => {
								if (saved) setName("");
							});
						}}
						className="flex shrink-0 items-center gap-4 rounded-[var(--radius-sm)] bg-control-primary-bg px-12 py-4 tr-text-ui text-control-primary-text hover:bg-control-primary-bg-hovered disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text"
					>
						<Plus className="size-16" /> Save preset
					</button>
				</div>
			</section>

			<section className="space-y-8 border-border-default border-t pt-16">
				<div>
					<h3 className="tr-title-section text-text-default">Group limits</h3>
					<p className="tr-text-metadata text-text-muted">
						Applies to new groups. Existing over-limit arrangements remain usable and reducible.
					</p>
				</div>
				<div data-testid="layout-group-limits" className="grid max-w-sm gap-8">
					<div className="space-y-4 tr-text-metadata text-text-muted">
						<label htmlFor="layout-side-group-limit">Side groups</label>
						<div className="flex items-center gap-8">
							<input
								id="layout-side-group-limit"
								type="number"
								min={minimumSideLimit}
								max={32}
								value={sideLimit}
								onChange={(event) => setSideLimit(event.target.value)}
								aria-label="Maximum side groups"
								className="w-96 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-8 py-4 tr-text-ui text-text-default outline-none focus:ring-2 focus:ring-primary"
							/>
							<button
								type="button"
								aria-label="Save side group limit"
								disabled={
									!Number.isInteger(Number(sideLimit)) ||
									Number(sideLimit) < minimumSideLimit ||
									Number(sideLimit) > 32 ||
									Number(sideLimit) === settings.maxSideGroups ||
									saving
								}
								onClick={() => void saveSettings({ ...settings, maxSideGroups: Number(sideLimit) })}
								className="rounded-[var(--radius-sm)] border border-border-default px-12 py-4 tr-text-ui text-text-default hover:bg-control-bg-hovered disabled:text-control-disabled-text"
							>
								Save
							</button>
						</div>
					</div>
					<div className="space-y-4 tr-text-metadata text-text-muted">
						<label htmlFor="layout-bottom-group-limit">Bottom groups</label>
						<div className="flex items-center gap-8">
							<input
								id="layout-bottom-group-limit"
								type="number"
								min={minimumBottomLimit}
								max={32}
								value={bottomLimit}
								onChange={(event) => setBottomLimit(event.target.value)}
								aria-label="Maximum bottom groups"
								className="w-96 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-8 py-4 tr-text-ui text-text-default outline-none focus:ring-2 focus:ring-primary"
							/>
							<button
								type="button"
								aria-label="Save bottom group limit"
								disabled={
									!Number.isInteger(Number(bottomLimit)) ||
									Number(bottomLimit) < minimumBottomLimit ||
									Number(bottomLimit) > 32 ||
									Number(bottomLimit) === settings.maxBottomGroups ||
									saving
								}
								onClick={() =>
									void saveSettings({ ...settings, maxBottomGroups: Number(bottomLimit) })
								}
								className="rounded-[var(--radius-sm)] border border-border-default px-12 py-4 tr-text-ui text-text-default hover:bg-control-bg-hovered disabled:text-control-disabled-text"
							>
								Save
							</button>
						</div>
					</div>
				</div>
			</section>

			<ConfirmDialog
				open={applying !== null}
				onOpenChange={(open) => {
					if (!open) setApplying(null);
				}}
				title="Apply this layout?"
				description="Open files, chats, documents, and terminals are preserved, but their groups and proportions will be rearranged for every client in this workspace. Group limits are raised if this preset needs more groups."
				confirmLabel="Apply layout"
				confirmTestId="layout-apply-confirm"
				onConfirm={() => {
					if (applying) apply(applying);
					setApplying(null);
				}}
			/>
		</div>
	);
}
