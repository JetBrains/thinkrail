import {
	RiCheckLine as Check,
	RiPencilLine as Pencil,
	RiAddLine as Plus,
	RiArrowDownSLine,
	RiArrowRightSLine,
	RiDashboardLine,
	RiFocusLine,
	RiLayoutLine,
	RiLayoutRightLine,
	RiQuestionLine,
	RiDeleteBin6Line as Trash2,
	RiCloseLine as X,
} from "@remixicon/react";
import type { LayoutPreset } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { t as translate, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { useEffect, useMemo, useRef, useState } from "react";
import { randomId } from "../lib";
import { ConfirmDialog } from "../panels/ConfirmDialog";
import { SettingsGroup } from "../panels/SettingsGroup";
import { SETTINGS_ROWS_CONTAINER, SettingsRow } from "../panels/SettingsRow";
import { toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import {
	BUILTIN_LAYOUT_PRESETS,
	captureWorkbenchPreset,
	DEFAULT_LAYOUT_PRESET_ID,
	frameMatchesPreset,
	layoutPresetName,
	minimumBottomGroupLimit,
	minimumSideGroupLimit,
	resolveLayoutPreset,
} from "./layout";
import { applyLayoutPresetLocally } from "./layoutState";

const BUILTIN_PRESET_IDS = new Set(BUILTIN_LAYOUT_PRESETS.map((preset) => preset.id));
const MAX_CUSTOM_PRESETS = 32;
const GROUP_LIMIT_MIN = 1;
const GROUP_LIMIT_MAX = 32;

const PRESET_DESCRIPTIONS: Readonly<Record<string, MessageKey>> = {
	balanced: "workbench.layoutSettings.balancedDescription",
	focus: "workbench.layoutSettings.focusDescription",
	review: "workbench.layoutSettings.reviewDescription",
};

const PRESET_ICONS: Record<string, typeof RiDashboardLine> = {
	balanced: RiDashboardLine,
	focus: RiFocusLine,
	review: RiLayoutRightLine,
};

async function updateCustomPresets(customLayoutPresets: LayoutPreset[]): Promise<boolean> {
	try {
		await getTransport().request("settings.update", {
			config: { customLayoutPresets },
		});
		return true;
	} catch (error) {
		toast.error(errorText(error), translate("workbench.layoutSettings.saveFailed"));
		return false;
	}
}

type GroupLimitKey = "maxSideGroups" | "maxBottomGroups";

function commitGroupLimit(key: GroupLimitKey, value: number): void {
	const state = useAppStore.getState();
	if (state.localLayoutPreferences[key] === value) return;
	state.setLocalLayoutPreferences({ ...state.localLayoutPreferences, [key]: value });
}

function parseGroupLimit(draft: string): number | null {
	if (!/^\d+$/.test(draft)) return null;
	const value = Number(draft);
	return value >= GROUP_LIMIT_MIN && value <= GROUP_LIMIT_MAX ? value : null;
}

function GroupLimitInput({
	id,
	label,
	limitKey,
}: {
	id: string;
	label: string;
	limitKey: GroupLimitKey;
}) {
	const t = useT();
	const saved = useAppStore((state) => state.localLayoutPreferences[limitKey]);
	const savedText = String(saved);
	const [draft, setDraft] = useState(savedText);
	useEffect(() => setDraft(savedText), [savedText]);
	const parsed = parseGroupLimit(draft);
	const invalid = parsed === null;
	const errorId = `${id}-error`;

	const commit = () => {
		if (parsed !== null) commitGroupLimit(limitKey, parsed);
	};

	return (
		<span className="flex flex-col items-end gap-2">
			<input
				id={id}
				type="number"
				min={GROUP_LIMIT_MIN}
				max={GROUP_LIMIT_MAX}
				step={1}
				inputMode="numeric"
				value={draft}
				aria-label={label}
				aria-invalid={invalid}
				aria-describedby={invalid ? errorId : undefined}
				data-settings-draft-input
				onChange={(event) => setDraft(event.currentTarget.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commit();
					} else if (event.key === "Escape") {
						setDraft(savedText);
					}
				}}
				className="h-32 w-64 rounded-sm border border-control-border-default bg-control-bg px-8 tr-text-ui text-text-default outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-control-border-active focus-visible:ring-2 focus-visible:ring-primary aria-invalid:border-feedback-error"
			/>
			{invalid ? (
				<span id={errorId} className="text-feedback-error tr-text-metadata">
					{t("workbench.layoutSettings.limitRange", { min: GROUP_LIMIT_MIN, max: GROUP_LIMIT_MAX })}
				</span>
			) : null}
		</span>
	);
}

export function LayoutSettings() {
	const t = useT();
	const customLayoutPresets = useAppStore((state) => state.customLayoutPresets);
	const preferences = useAppStore((state) => state.localLayoutPreferences);
	const frame = useAppStore((state) => state.workbenchFrame);
	const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);
	const [name, setName] = useState("");
	const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
	const [applying, setApplying] = useState<LayoutPreset | null>(null);
	const [saving, setSaving] = useState(false);
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const [addLayoutOpen, setAddLayoutOpen] = useState(false);
	const addLayoutInputRef = useRef<HTMLInputElement>(null);

	const presets = useMemo(
		() => [
			...BUILTIN_LAYOUT_PRESETS,
			...customLayoutPresets.filter((preset) => !BUILTIN_PRESET_IDS.has(preset.id)),
		],
		[customLayoutPresets],
	);
	const selected = resolveLayoutPreset(preferences.defaultPresetId, customLayoutPresets);
	const canApply = !saving && activeWorkspaceId !== null && frame !== null;

	const appliedPresetId = useMemo(() => {
		if (!frame) return null;
		return presets.find((preset) => frameMatchesPreset(frame, preset))?.id ?? null;
	}, [frame, presets]);

	const saveCustomPresets = (customPresets: LayoutPreset[]): Promise<boolean> => {
		setSaving(true);
		return updateCustomPresets(customPresets).finally(() => setSaving(false));
	};

	const apply = (preset: LayoutPreset) => {
		if (!activeWorkspaceId || !frame) return;
		try {
			applyLayoutPresetLocally(preset);
			toast.success(t("workbench.layoutSettings.applied", { name: layoutPresetName(t, preset) }));
		} catch (error) {
			toast.error(errorText(error), t("workbench.layoutSettings.applyFailed"));
		}
	};

	const commitRename = (presetId: string) => {
		if (saving) return;
		const nextName = renaming?.id === presetId ? renaming.name.trim() : "";
		if (!nextName) return;
		void saveCustomPresets(
			customLayoutPresets.map((preset) =>
				preset.id === presetId ? { ...preset, name: nextName } : preset,
			),
		).then((saved) => {
			if (saved) setRenaming(null);
		});
	};

	return (
		<div data-testid="settings-layout" className={SETTINGS_ROWS_CONTAINER}>
			<div className="grid gap-8 sm:grid-cols-2">
				{presets.map((preset) => {
					const isStoredDefault = preset.id === preferences.defaultPresetId;
					const isEffectiveDefault = preset.id === selected.id;
					const isCurrentlyApplied = preset.id === appliedPresetId;
					const custom =
						!BUILTIN_PRESET_IDS.has(preset.id) &&
						customLayoutPresets.some((candidate) => candidate.id === preset.id);
					const Icon = PRESET_ICONS[preset.id] ?? RiLayoutLine;
					const presetName = layoutPresetName(t, preset);
					const description = PRESET_DESCRIPTIONS[preset.id];

					return (
						<div
							key={preset.id}
							data-testid="layout-preset"
							data-default={isEffectiveDefault}
							data-applied={isCurrentlyApplied}
							className={`relative flex flex-col rounded-sm p-12 ${
								isCurrentlyApplied ? "bg-control-bg-selected" : "bg-control-bg"
							}`}
						>
							{isEffectiveDefault && (
								<div className="absolute top-12 right-12 flex items-center gap-4">
									<span className="rounded-full bg-primary-subtle px-8 py-2 tr-text-label-pill text-primary">
										{isStoredDefault ? t("common.default") : t("workbench.layoutSettings.fallback")}
									</span>
									<IconTooltip
										label={
											isStoredDefault
												? t("workbench.layoutSettings.defaultHint")
												: t("workbench.layoutSettings.fallbackHint")
										}
									>
										<button
											type="button"
											aria-label={t("workbench.layoutSettings.aboutDefault")}
											className="rounded-sm p-2 text-text-muted transition-colors hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary outline-none"
										>
											<RiQuestionLine className="size-14" />
										</button>
									</IconTooltip>
								</div>
							)}

							<Icon className="size-24 text-text-muted" />

							<div className="mt-8 flex items-center gap-4">
								{renaming?.id === preset.id ? (
									<input
										value={renaming.name}
										onChange={(event) => setRenaming({ id: preset.id, name: event.target.value })}
										onKeyDown={(event) => {
											if (event.key === "Enter") commitRename(preset.id);
											if (event.key === "Escape") setRenaming(null);
										}}
										aria-label={t("workbench.layoutSettings.renameNamed", { name: presetName })}
										data-settings-draft-input
										maxLength={200}
										className="min-w-0 flex-1 rounded-sm border border-control-border-default bg-control-bg px-4 py-2 tr-text-ui text-text-default outline-none focus:border-control-border-active"
									/>
								) : (
									<span className="truncate tr-text-ui text-text-default">{presetName}</span>
								)}
							</div>

							<p className="mt-2 tr-text-metadata text-text-muted">
								{description
									? t(description)
									: t("workbench.layoutSettings.groupCounts", {
											left: preset.left.groups.length,
											right: preset.right.groups.length,
											bottom: preset.bottom.groups.length,
										})}
							</p>

							<div className="mt-auto flex flex-wrap items-center justify-end gap-4 pt-12">
								{custom && (
									<div className="mr-auto flex items-center gap-2">
										{renaming?.id === preset.id ? (
											<>
												<button
													type="button"
													aria-label={t("workbench.layoutSettings.saveName", { name: presetName })}
													disabled={!renaming.name.trim() || saving}
													onClick={() => commitRename(preset.id)}
													className="rounded-sm p-4 text-primary hover:bg-control-bg-hovered disabled:text-control-disabled-text"
												>
													<Check className="size-14" />
												</button>
												<button
													type="button"
													aria-label={t("workbench.layoutSettings.cancelRename", {
														name: presetName,
													})}
													onClick={() => setRenaming(null)}
													className="rounded-sm p-4 text-text-muted hover:bg-control-bg-hovered"
												>
													<X className="size-14" />
												</button>
											</>
										) : (
											<button
												type="button"
												aria-label={t("workbench.layoutSettings.renameNamed", { name: presetName })}
												disabled={saving}
												onClick={() => setRenaming({ id: preset.id, name: preset.name })}
												className="rounded-sm p-4 text-text-muted hover:bg-control-bg-hovered hover:text-text-default disabled:text-control-disabled-text"
											>
												<Pencil className="size-14" />
											</button>
										)}
										<button
											type="button"
											aria-label={t("workbench.layoutSettings.deleteNamed", { name: presetName })}
											disabled={saving}
											onClick={() => {
												const customPresets = customLayoutPresets.filter(
													(candidate) => candidate.id !== preset.id,
												);
												void saveCustomPresets(customPresets).then((saved) => {
													if (!saved) return;
													const state = useAppStore.getState();
													if (state.localLayoutPreferences.defaultPresetId !== preset.id) return;
													state.setLocalLayoutPreferences({
														...state.localLayoutPreferences,
														defaultPresetId: DEFAULT_LAYOUT_PRESET_ID,
													});
												});
											}}
											className="rounded-sm p-4 text-text-muted hover:bg-feedback-error-subtle hover:text-feedback-error disabled:text-control-disabled-text"
										>
											<Trash2 className="size-14" />
										</button>
									</div>
								)}
								{!isStoredDefault && (
									<Button
										variant="outline"
										size="sm"
										disabled={saving}
										onClick={() =>
											useAppStore.getState().setLocalLayoutPreferences({
												...preferences,
												defaultPresetId: preset.id,
												maxSideGroups: Math.max(
													preferences.maxSideGroups,
													minimumSideGroupLimit(preset),
												),
												maxBottomGroups: Math.max(
													preferences.maxBottomGroups,
													minimumBottomGroupLimit(preset),
												),
											})
										}
									>
										{t("workbench.layoutSettings.setDefault")}
									</Button>
								)}
								<Button
									variant="default"
									size="sm"
									disabled={!canApply || isCurrentlyApplied}
									onClick={() => setApplying(preset)}
								>
									{t("workbench.layoutSettings.applyNow")}
								</Button>
							</div>
						</div>
					);
				})}

				<Popover
					open={addLayoutOpen}
					onOpenChange={(open) => {
						setAddLayoutOpen(open);
						if (open) setName("");
					}}
				>
					<PopoverTrigger asChild>
						<button
							type="button"
							data-testid="layout-add-new"
							disabled={!frame || customLayoutPresets.length >= MAX_CUSTOM_PRESETS || saving}
							title={
								customLayoutPresets.length >= MAX_CUSTOM_PRESETS
									? t("workbench.layoutSettings.customLimit", { limit: MAX_CUSTOM_PRESETS })
									: undefined
							}
							className="group flex flex-col rounded-sm bg-control-bg p-12 text-left transition-colors hover:bg-control-bg-hovered disabled:cursor-not-allowed disabled:bg-control-disabled-bg"
						>
							<Plus className="size-24 text-text-muted group-disabled:text-control-disabled-text" />
							<p className="mt-8 tr-text-ui text-text-default group-disabled:text-control-disabled-text">
								{t("workbench.layoutSettings.addNew")}
							</p>
							<p className="mt-2 tr-text-metadata text-text-muted group-disabled:text-control-disabled-text">
								{t("workbench.layoutSettings.addNewDescription")}
							</p>
						</button>
					</PopoverTrigger>
					<PopoverContent
						align="start"
						className="w-280 p-12"
						onOpenAutoFocus={(event) => {
							event.preventDefault();
							addLayoutInputRef.current?.focus();
						}}
					>
						<form
							data-testid="layout-preset-save-row"
							onSubmit={(event) => {
								event.preventDefault();
								if (!frame || !name.trim() || saving) return;
								const preset = captureWorkbenchPreset(frame, randomId("preset"), name.trim());
								void saveCustomPresets([...customLayoutPresets, preset]).then((saved) => {
									if (saved) {
										setName("");
										setAddLayoutOpen(false);
									}
								});
							}}
							className="flex flex-col gap-12"
						>
							<input
								ref={addLayoutInputRef}
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder={t("workbench.layoutSettings.namePlaceholder")}
								aria-label={t("workbench.layoutSettings.nameLabel")}
								maxLength={200}
								className="w-full rounded-sm border border-control-border-default bg-control-bg px-8 py-4 tr-text-ui text-text-default outline-none placeholder:text-text-subtle focus:border-control-border-active"
							/>
							<div className="flex justify-end gap-8">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => setAddLayoutOpen(false)}
								>
									{t("common.cancel")}
								</Button>
								<Button
									type="submit"
									variant="default"
									size="sm"
									aria-label={t("workbench.layoutSettings.savePreset")}
									disabled={!name.trim() || saving}
								>
									{t("common.save")}
								</Button>
							</div>
						</form>
					</PopoverContent>
				</Popover>
			</div>

			<SettingsRow
				className="mt-24"
				label={t("workbench.layoutSettings.resetToDefault")}
				description={t("workbench.layoutSettings.resetDescription", {
					name: layoutPresetName(t, selected),
				})}
				control={
					<Button
						variant="outline"
						size="sm"
						data-testid="layout-reset-default"
						disabled={!canApply}
						onClick={() => setApplying(selected)}
					>
						{t("workbench.layoutSettings.reset")}
					</Button>
				}
			/>

			<div className="flex flex-col">
				<button
					type="button"
					onClick={() => setAdvancedOpen((v) => !v)}
					aria-expanded={advancedOpen}
					data-testid="layout-advanced-toggle"
					className="flex w-full items-start gap-8 rounded-sm py-12 text-left outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary"
				>
					<span className="mt-2 shrink-0">
						{advancedOpen ? (
							<RiArrowDownSLine className="size-16 text-text-muted" aria-hidden="true" />
						) : (
							<RiArrowRightSLine className="size-16 text-text-muted" aria-hidden="true" />
						)}
					</span>
					<span className="tr-text-ui text-text-default">
						{t("workbench.layoutSettings.advanced")}
					</span>
				</button>
				{advancedOpen && (
					<div className="pb-12">
						<SettingsGroup
							title={t("workbench.layoutSettings.groupLimits")}
							description={t("workbench.layoutSettings.groupLimitsDescription")}
							testId="layout-group-limits"
						>
							<SettingsRow
								label={t("workbench.layoutSettings.sideGroups")}
								control={
									<GroupLimitInput
										id="layout-side-group-limit"
										label={t("workbench.layoutSettings.maxSideGroups")}
										limitKey="maxSideGroups"
									/>
								}
							/>
							<SettingsRow
								label={t("workbench.layoutSettings.bottomGroups")}
								control={
									<GroupLimitInput
										id="layout-bottom-group-limit"
										label={t("workbench.layoutSettings.maxBottomGroups")}
										limitKey="maxBottomGroups"
									/>
								}
							/>
						</SettingsGroup>
					</div>
				)}
			</div>

			<ConfirmDialog
				open={applying !== null}
				onOpenChange={(open) => {
					if (!open) setApplying(null);
				}}
				title={t("workbench.layoutSettings.applyTitle")}
				description={t("workbench.layoutSettings.applyDescription")}
				confirmLabel={t("workbench.layoutSettings.applyConfirm")}
				confirmTestId="layout-apply-confirm"
				onConfirm={() => {
					if (applying) apply(applying);
					setApplying(null);
				}}
			/>
		</div>
	);
}
