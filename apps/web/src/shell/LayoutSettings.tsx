import {
	RiAddLine as Plus,
	RiDashboardLine,
	RiFocusLine,
	RiLayoutLeftLine,
	RiLayoutLine,
	RiLayoutRightLine,
} from "@remixicon/react";
import {
	ARTIFACT_ROLES_PROTOCOL_VERSION,
	ARTIFACTS_PROTOCOL_VERSION,
	CONTAINER_PROTOCOL_VERSION,
	LAYOUT_PLAN_PRESET_PROTOCOL_VERSION,
	type LayoutPreset,
	type LayoutToolId,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { t as translate, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { Switch } from "@thinkrail/ui/switch";
import { cn } from "@thinkrail/ui/utils";
import { useRef, useState } from "react";
import { randomId } from "../lib";
import { ConfirmDialog } from "../panels/ConfirmDialog";
import {
	type LayoutLimitKey,
	useClientPreferenceReset,
	useLayoutLimitReset,
} from "../panels/settingDefaults";
import { SETTING, settingProps } from "../panels/settingsCatalog";
import {
	SETTINGS_INPUT,
	SETTINGS_LIST_PRIMARY,
	SETTINGS_LIST_ROW,
	SETTINGS_ROWS,
	SETTINGS_TAG,
	SettingsChoice,
	type SettingsChoiceOption,
	SettingsDisclosure,
	SettingsGroup,
	SettingsList,
	SettingsNumberField,
	SettingsPage,
	SettingsRow,
	SettingsSubheading,
	useSettingsDialogContainer,
	useSettingsListRow,
} from "../settingsKit";
import { type MarkdownOutlineSide, toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import {
	BUILTIN_LAYOUT_PRESETS,
	captureWorkbenchPreset,
	DEFAULT_LAYOUT_PRESET_ID,
	frameMatchesPreset,
	layoutPresetName,
	minimumBottomGroupLimit,
	minimumSideGroupLimit,
	presetPlacesTool,
	resolveLayoutPreset,
} from "./layout";
import { applyLayoutPresetLocally } from "./layoutState";

const BUILTIN_PRESET_IDS = new Set(BUILTIN_LAYOUT_PRESETS.map((preset) => preset.id));
const MAX_CUSTOM_PRESETS = 32;
const GROUP_LIMIT_MIN = 1;
const GROUP_LIMIT_MAX = 32;
const PRESETS_LIST = "layout-presets";

const PRESET_DESCRIPTIONS: Readonly<Record<string, MessageKey>> = {
	balanced: "workbench.layoutSettings.balancedDescription",
	focus: "workbench.layoutSettings.focusDescription",
	review: "workbench.layoutSettings.reviewDescription",
	"left-tools": "workbench.layoutSettings.leftToolsDescription",
};

const PRESET_ICONS: Record<string, typeof RiDashboardLine> = {
	balanced: RiDashboardLine,
	focus: RiFocusLine,
	review: RiLayoutRightLine,
	"left-tools": RiLayoutLeftLine,
};

const NEWER_HOST_TOOLS: readonly { tool: LayoutToolId; since: number; message: MessageKey }[] = [
	{
		tool: "plan",
		since: LAYOUT_PLAN_PRESET_PROTOCOL_VERSION,
		message: "workbench.layoutSettings.planNeedsNewerHost",
	},
	{
		tool: "artifacts",
		since: ARTIFACTS_PROTOCOL_VERSION,
		message: "workbench.layoutSettings.artifactsNeedsNewerHost",
	},
	{
		tool: "orchestrator",
		since: CONTAINER_PROTOCOL_VERSION,
		message: "workbench.layoutSettings.orchestratorNeedsNewerHost",
	},
];

const DEFAULT_CHIP = "rounded-full bg-primary-subtle px-8 py-2 tr-text-label-pill text-primary";

const focusOnMount = (node: HTMLInputElement | null) => node?.focus();

async function updateCustomPresets(customLayoutPresets: LayoutPreset[]): Promise<boolean> {
	const protocolVersion = useAppStore.getState().protocolVersion ?? 0;
	const tooNew = NEWER_HOST_TOOLS.find(
		({ tool, since }) =>
			protocolVersion < since &&
			customLayoutPresets.some((preset) => presetPlacesTool(preset, tool)),
	);
	if (tooNew) {
		toast.error(translate(tooNew.message), translate("workbench.layoutSettings.saveFailed"));
		return false;
	}
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

function commitGroupLimit(key: LayoutLimitKey, value: number): undefined {
	const state = useAppStore.getState();
	if (state.localLayoutPreferences[key] === value) return;
	state.setLocalLayoutPreferences({ ...state.localLayoutPreferences, [key]: value });
}

function setDefaultPreset(preset: LayoutPreset): void {
	const state = useAppStore.getState();
	const preferences = state.localLayoutPreferences;
	state.setLocalLayoutPreferences({
		...preferences,
		defaultPresetId: preset.id,
		maxSideGroups: Math.max(preferences.maxSideGroups, minimumSideGroupLimit(preset)),
		maxBottomGroups: Math.max(preferences.maxBottomGroups, minimumBottomGroupLimit(preset)),
	});
}

export function deletablePreset(
	customs: readonly LayoutPreset[],
	presetId: string,
): LayoutPreset | null {
	return customs.find((preset) => preset.id === presetId) ?? null;
}

function forgetDefault(presetId: string): void {
	const state = useAppStore.getState();
	if (state.localLayoutPreferences.defaultPresetId !== presetId) return;
	state.setLocalLayoutPreferences({
		...state.localLayoutPreferences,
		defaultPresetId: DEFAULT_LAYOUT_PRESET_ID,
	});
}

function GroupLimitRow({
	limitKey,
	rowId,
	label,
	fieldLabel,
}: {
	limitKey: LayoutLimitKey;
	rowId: string;
	label: string;
	fieldLabel: string;
}) {
	const saved = useAppStore((state) => state.localLayoutPreferences[limitKey]);
	const reset = useLayoutLimitReset(limitKey);
	return (
		<SettingsRow
			rowId={rowId}
			label={label}
			reset={reset}
			control={
				<SettingsNumberField
					label={fieldLabel}
					value={saved}
					min={GROUP_LIMIT_MIN}
					max={GROUP_LIMIT_MAX}
					onCommit={(value) => commitGroupLimit(limitKey, value)}
				/>
			}
		/>
	);
}

interface Renaming {
	readonly id: string;
	readonly name: string;
}

export function PresetRow({
	preset,
	custom,
	storedDefault,
	effectiveDefault,
	applied,
	canApply,
	saving,
	renaming,
	onApply,
	onRename,
	onRenameCommit,
	onDelete,
}: {
	preset: LayoutPreset;
	custom: boolean;
	storedDefault: boolean;
	effectiveDefault: boolean;
	applied: boolean;
	canApply: boolean;
	saving: boolean;
	renaming: Renaming | null;
	onApply: () => void;
	onRename: (next: Renaming | null) => void;
	onRenameCommit: () => void;
	onDelete: () => void;
}) {
	const t = useT();
	const { rowProps, primaryProps, sideProps } = useSettingsListRow(preset.id);
	const name = layoutPresetName(t, preset);
	const description = PRESET_DESCRIPTIONS[preset.id];
	const Icon = PRESET_ICONS[preset.id] ?? RiLayoutLine;
	const appliable = canApply && !applied;
	return (
		<li
			{...rowProps}
			data-testid="layout-preset"
			data-default={effectiveDefault}
			data-applied={applied}
			className={cn(SETTINGS_LIST_ROW, "flex-wrap")}
		>
			{renaming ? (
				<input
					ref={focusOnMount}
					{...primaryProps}
					value={renaming.name}
					onChange={(event) => onRename({ id: preset.id, name: event.target.value })}
					onKeyDown={(event) => {
						if (isImeComposing(event.nativeEvent)) return;
						if (event.key === "Enter") {
							event.preventDefault();
							onRenameCommit();
						} else if (event.key === "Escape") {
							event.preventDefault();
							onRename(null);
						}
					}}
					aria-label={t("workbench.layoutSettings.renameNamed", { name })}
					maxLength={200}
					className={cn(SETTINGS_INPUT, "min-w-160 flex-1")}
				/>
			) : (
				<button
					type="button"
					{...primaryProps}
					data-testid="layout-preset-apply"
					aria-disabled={appliable ? undefined : true}
					onClick={() => {
						if (appliable) onApply();
					}}
					className={SETTINGS_LIST_PRIMARY}
				>
					<span className="flex flex-wrap items-center gap-8">
						<Icon aria-hidden className="size-16 shrink-0 text-text-muted" />
						<span className="tr-text-ui text-text-default">{name}</span>
						{effectiveDefault ? (
							<span className={DEFAULT_CHIP}>
								{storedDefault ? t("common.default") : t("workbench.layoutSettings.fallback")}
							</span>
						) : null}
						{applied ? (
							<span className={cn(SETTINGS_TAG, "text-text-muted")}>
								{t("workbench.layoutSettings.current")}
							</span>
						) : null}
						{custom ? (
							<span className={cn(SETTINGS_TAG, "text-text-muted")}>
								{t("workbench.layoutSettings.custom")}
							</span>
						) : null}
					</span>
					<span className="tr-text-metadata text-text-muted">
						{description
							? t(description)
							: t("workbench.layoutSettings.groupCounts", {
									left: preset.left.groups.length,
									right: preset.right.groups.length,
									bottom: preset.bottom.groups.length,
								})}
					</span>
					{effectiveDefault ? (
						<span data-testid="layout-default-hint" className="tr-text-metadata text-text-muted">
							{storedDefault
								? t("workbench.layoutSettings.defaultHint")
								: t("workbench.layoutSettings.fallbackHint")}
						</span>
					) : null}
				</button>
			)}
			<span className="flex shrink-0 flex-wrap items-center justify-end gap-4">
				{renaming ? (
					<>
						<Button
							variant="soft-primary"
							size="s"
							{...sideProps}
							aria-label={t("workbench.layoutSettings.saveName", { name })}
							disabled={!renaming.name.trim() || saving}
							onClick={onRenameCommit}
						>
							{t("common.save")}
						</Button>
						<Button
							variant="ghost"
							size="s"
							{...sideProps}
							aria-label={t("workbench.layoutSettings.cancelRename", { name })}
							onClick={() => onRename(null)}
						>
							{t("common.cancel")}
						</Button>
					</>
				) : (
					<>
						{storedDefault ? null : (
							<Button
								variant="outline"
								size="s"
								{...sideProps}
								disabled={saving}
								onClick={() => setDefaultPreset(preset)}
							>
								{t("workbench.layoutSettings.setDefault")}
							</Button>
						)}
						{custom ? (
							<>
								<Button
									variant="ghost"
									size="s"
									{...sideProps}
									aria-label={t("workbench.layoutSettings.renameNamed", { name })}
									disabled={saving}
									onClick={() => onRename({ id: preset.id, name: preset.name })}
								>
									{t("workbench.layoutSettings.rename")}
								</Button>
								<Button
									variant="ghost"
									size="s"
									{...sideProps}
									aria-label={t("workbench.layoutSettings.deleteNamed", { name })}
									data-testid="layout-preset-delete"
									disabled={saving}
									onClick={onDelete}
								>
									{t("workbench.layoutSettings.delete")}
								</Button>
							</>
						) : null}
					</>
				)}
			</span>
		</li>
	);
}

function AddLayoutRow({
	saving,
	onSave,
}: {
	saving: boolean;
	onSave: (name: string) => Promise<boolean>;
}) {
	const t = useT();
	const container = useSettingsDialogContainer();
	const frame = useAppStore((state) => state.workbenchFrame);
	const used = useAppStore(
		(state) =>
			state.customLayoutPresets.filter((preset) => !BUILTIN_PRESET_IDS.has(preset.id)).length,
	);
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const input = useRef<HTMLInputElement>(null);
	const props = settingProps(t, SETTING.layoutAdd);
	return (
		<SettingsRow
			{...props}
			description={
				<>
					{props.description}
					<span data-testid="layout-custom-limit" className="block">
						{t("workbench.layoutSettings.customLimitUsed", {
							limit: MAX_CUSTOM_PRESETS,
							count: used,
						})}
					</span>
				</>
			}
			control={
				<Popover
					open={open}
					onOpenChange={(next) => {
						setOpen(next);
						if (next) setName("");
					}}
				>
					<PopoverTrigger asChild>
						<Button
							variant="outline"
							size="m"
							iconLeft={Plus}
							tabIndex={0}
							data-testid="layout-add-new"
							disabled={!frame || used >= MAX_CUSTOM_PRESETS || saving}
						>
							{t("workbench.layoutSettings.addLayout")}
						</Button>
					</PopoverTrigger>
					<PopoverContent
						align="end"
						container={container}
						className="w-280 p-12"
						onOpenAutoFocus={(event) => {
							event.preventDefault();
							input.current?.focus();
						}}
					>
						<form
							data-testid="layout-preset-save-row"
							onSubmit={(event) => {
								event.preventDefault();
								if (!name.trim() || saving) return;
								void onSave(name.trim()).then((saved) => {
									if (saved) {
										setName("");
										setOpen(false);
									}
								});
							}}
							className="flex flex-col gap-12"
						>
							<input
								ref={input}
								value={name}
								tabIndex={0}
								onChange={(event) => setName(event.target.value)}
								placeholder={t("workbench.layoutSettings.namePlaceholder")}
								aria-label={t("workbench.layoutSettings.nameLabel")}
								maxLength={200}
								className={cn(SETTINGS_INPUT, "w-full")}
							/>
							<div className="flex justify-end gap-8">
								<Button
									type="button"
									variant="ghost"
									size="m"
									tabIndex={0}
									onClick={() => setOpen(false)}
								>
									{t("common.cancel")}
								</Button>
								<Button
									type="submit"
									variant="primary"
									size="m"
									tabIndex={0}
									aria-label={t("workbench.layoutSettings.savePreset")}
									disabled={!name.trim() || saving}
								>
									{t("common.save")}
								</Button>
							</div>
						</form>
					</PopoverContent>
				</Popover>
			}
		/>
	);
}

function PresetsGroup() {
	const t = useT();
	const customLayoutPresets = useAppStore((state) => state.customLayoutPresets);
	const preferences = useAppStore((state) => state.localLayoutPreferences);
	const frame = useAppStore((state) => state.workbenchFrame);
	const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);
	const [renaming, setRenaming] = useState<Renaming | null>(null);
	const [applying, setApplying] = useState<LayoutPreset | null>(null);
	const [deleting, setDeleting] = useState<LayoutPreset | null>(null);
	const [saving, setSaving] = useState(false);

	const customs = customLayoutPresets.filter((preset) => !BUILTIN_PRESET_IDS.has(preset.id));
	const presets = [...BUILTIN_LAYOUT_PRESETS, ...customs];
	const selected = resolveLayoutPreset(preferences.defaultPresetId, customLayoutPresets);
	const hasWorkbench = activeWorkspaceId !== null && frame !== null;
	const canApply = !saving && hasWorkbench;
	const appliedPresetId = frame
		? (presets.find((preset) => frameMatchesPreset(frame, preset))?.id ?? null)
		: null;

	const saveCustomPresets = (next: LayoutPreset[]): Promise<boolean> => {
		setSaving(true);
		return updateCustomPresets(next).finally(() => setSaving(false));
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

	const commitRename = () => {
		const nextName = renaming?.name.trim() ?? "";
		if (saving || renaming === null || !nextName) return;
		const { id } = renaming;
		void saveCustomPresets(
			customLayoutPresets.map((preset) =>
				preset.id === id ? { ...preset, name: nextName } : preset,
			),
		).then((saved) => {
			if (saved) setRenaming(null);
		});
	};

	const remove = (preset: LayoutPreset) => {
		void saveCustomPresets(
			customLayoutPresets.filter((candidate) => candidate.id !== preset.id),
		).then((saved) => {
			if (saved) forgetDefault(preset.id);
		});
	};

	const askDelete = (presetId: string) => {
		const preset = deletablePreset(customs, presetId);
		if (preset && !saving) setDeleting(preset);
	};

	return (
		<SettingsGroup
			title={t("workbench.layoutSettings.presets")}
			description={
				hasWorkbench
					? t("workbench.layoutSettings.presetsDescription")
					: t("workbench.layoutSettings.presetsNoWorkspace")
			}
		>
			<div className="border-border-muted border-b py-4">
				<SettingsList
					focusList={PRESETS_LIST}
					label={t(SETTING.layoutPresets.label)}
					rowIds={presets.map((preset) => preset.id)}
					settingId={SETTING.layoutPresets.id}
					testId="layout-presets"
					onRemove={askDelete}
				>
					{presets.map((preset) => (
						<PresetRow
							key={preset.id}
							preset={preset}
							custom={customs.includes(preset)}
							storedDefault={preset.id === preferences.defaultPresetId}
							effectiveDefault={preset.id === selected.id}
							applied={preset.id === appliedPresetId}
							canApply={canApply}
							saving={saving}
							renaming={renaming?.id === preset.id ? renaming : null}
							onApply={() => setApplying(preset)}
							onRename={setRenaming}
							onRenameCommit={commitRename}
							onDelete={() => askDelete(preset.id)}
						/>
					))}
				</SettingsList>
			</div>
			<AddLayoutRow
				saving={saving}
				onSave={(name) =>
					frame
						? saveCustomPresets([
								...customLayoutPresets,
								captureWorkbenchPreset(frame, randomId("preset"), name),
							])
						: Promise.resolve(false)
				}
			/>
			<SettingsRow
				{...settingProps(t, SETTING.layoutReset)}
				description={t("workbench.layoutSettings.resetDescription", {
					name: layoutPresetName(t, selected),
				})}
				control={
					<Button
						variant="outline"
						size="m"
						tabIndex={0}
						data-testid="layout-reset-default"
						disabled={!canApply}
						onClick={() => setApplying(selected)}
					>
						{t("workbench.layoutSettings.reset")}
					</Button>
				}
			/>
			<SettingsDisclosure
				rowId="layout-advanced"
				label={t("workbench.layoutSettings.advanced")}
				settingIds={[SETTING.layoutGroupLimits.id]}
				testId="layout-advanced-toggle"
			>
				<div
					data-setting-id={SETTING.layoutGroupLimits.id}
					data-testid="layout-group-limits"
					className={SETTINGS_ROWS}
				>
					<SettingsSubheading
						title={t(SETTING.layoutGroupLimits.label)}
						description={t(SETTING.layoutGroupLimits.description)}
					/>
					<GroupLimitRow
						limitKey="maxSideGroups"
						rowId="layout-side-groups"
						label={t("workbench.layoutSettings.sideGroups")}
						fieldLabel={t("workbench.layoutSettings.maxSideGroups")}
					/>
					<GroupLimitRow
						limitKey="maxBottomGroups"
						rowId="layout-bottom-groups"
						label={t("workbench.layoutSettings.bottomGroups")}
						fieldLabel={t("workbench.layoutSettings.maxBottomGroups")}
					/>
				</div>
			</SettingsDisclosure>
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
			<ConfirmDialog
				open={deleting !== null}
				onOpenChange={(open) => {
					if (!open) setDeleting(null);
				}}
				title={t("workbench.layoutSettings.deleteTitle", {
					name: deleting ? layoutPresetName(t, deleting) : "",
				})}
				description={t("workbench.layoutSettings.deleteDescription")}
				confirmLabel={t("workbench.layoutSettings.deleteConfirm")}
				destructive
				confirmTestId="layout-delete-confirm"
				onConfirm={() => {
					if (deleting) remove(deleting);
					setDeleting(null);
				}}
			/>
		</SettingsGroup>
	);
}

function ArtifactsGroup() {
	const t = useT();
	const smart = useAppStore((state) => state.artifactsSmart);
	const reset = useClientPreferenceReset("artifactsSmart");
	return (
		<SettingsGroup title={t("workbench.layoutSettings.artifacts")} scope="device">
			<SettingsRow
				{...settingProps(t, SETTING.smartView)}
				control={
					<Switch
						checked={smart}
						label={t(SETTING.smartView.label)}
						testId="artifacts-smart-toggle"
						tabIndex={0}
						onCheckedChange={(next) => useAppStore.getState().setArtifactsSmart(next)}
					/>
				}
				reset={reset}
			/>
		</SettingsGroup>
	);
}

function DocumentsGroup() {
	const t = useT();
	const side = useAppStore((state) => state.markdownOutlineSide);
	const reset = useClientPreferenceReset("markdownOutlineSide");
	const options: SettingsChoiceOption<MarkdownOutlineSide>[] = [
		{ id: "left", label: t("settings.appearance.markdownOutlineSide.left") },
		{ id: "right", label: t("settings.appearance.markdownOutlineSide.right") },
	];
	return (
		<SettingsGroup title={t("workbench.layoutSettings.documents")} scope="device">
			<SettingsRow
				{...settingProps(t, SETTING.markdownOutline)}
				control={
					<SettingsChoice
						label={t(SETTING.markdownOutline.label)}
						options={options}
						value={side}
						cost="cheap"
						testId="markdown-outline-side-control"
						onSelect={(next) => useAppStore.getState().setMarkdownOutlineSide(next)}
					/>
				}
				reset={reset}
			/>
		</SettingsGroup>
	);
}

export function LayoutSettings() {
	const t = useT();
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const artifacts = protocolVersion !== null && protocolVersion >= ARTIFACT_ROLES_PROTOCOL_VERSION;
	return (
		<SettingsPage
			testId="settings-layout"
			title={t("settings.nav.layout")}
			description={t("workbench.layoutSettings.description")}
		>
			<PresetsGroup key="presets" />
			{artifacts ? <ArtifactsGroup key="artifacts" /> : null}
			<DocumentsGroup key="documents" />
		</SettingsPage>
	);
}
