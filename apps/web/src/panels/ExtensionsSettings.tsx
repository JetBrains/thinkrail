import {
	type ExtensionCatalogEntry,
	type ExtensionSettingDescriptor,
	type ExtensionSettingValues,
	OTHER_AGENT_SKILLS_PROTOCOL_VERSION,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { type Translator, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { Switch } from "@thinkrail/ui/switch";
import { Fragment, useEffect, useState } from "react";
import { webExtensionTitle, webOnlyExtensions } from "@/extensions";
import {
	SETTINGS_ROWS,
	SettingsGroup,
	SettingsNotice,
	SettingsPage,
	type SettingsReset,
	SettingsRow,
} from "@/settingsKit";
import { selectActiveRepoWorkspaceId, toast, useAppStore } from "@/store";
import { getTransport, supportsExtensionSettings, supportsPiPackages } from "@/transport";
import { ConfirmDialog } from "./ConfirmDialog";
import { InstallPackageDialog } from "./InstallPackageDialog";
import { GalleryLink, PiBuiltinsGroup, PiPackagesGroup } from "./PiPackagesSettings";
import { saveSettings } from "./saveSettings";
import { SETTING, settingProps } from "./settingsCatalog";
import { UPDATE_CHECK_KEY, usePiPackages } from "./usePiPackages";

const BUNDLED_DESCRIPTIONS: Readonly<Record<string, MessageKey>> = {
	board: "settings.extensions.board.description",
	"next-steps": "settings.extensions.next-steps.description",
	"session-insights": "settings.extensions.session-insights.description",
	visualize: "settings.extensions.visualize.description",
	"web-access": "settings.extensions.web-access.description",
};

function bundledDescription(t: Translator, entry: ExtensionCatalogEntry): string {
	const key = BUNDLED_DESCRIPTIONS[entry.name];
	return key ? t(key) : (entry.description ?? "");
}

/** The web half's translated title for a bundled extension, else the host's copy. */
function extensionTitle(t: Translator, entry: { name: string; title: string }): string {
	const key = webExtensionTitle(entry.name);
	return key ? t(key) : entry.title;
}

export function withWebOnlyEntries(
	t: Translator,
	entries: readonly ExtensionCatalogEntry[],
): ExtensionCatalogEntry[] {
	const webOnly = webOnlyExtensions(new Set(entries.map((entry) => entry.name)));
	return [
		...entries,
		...webOnly.map(({ name, title, description }) => ({
			name,
			title: t(title),
			...(description ? { description: t(description) } : {}),
			enabled: true,
			tools: [],
			hasChildExtensions: false,
		})),
	];
}

interface SettingCopy {
	title: MessageKey;
	description: MessageKey;
	settingId?: string;
}

const SETTING_COPY: Readonly<Record<string, Readonly<Record<string, SettingCopy>>>> = {
	"ask-user-question": {
		richPreviews: {
			title: "settings.extensions.ask-user-question.richPreviews.title",
			description: "settings.extensions.ask-user-question.richPreviews.description",
			settingId: SETTING.richPreviews.id,
		},
	},
};

function ExtensionSettingRow({
	entry,
	setting,
	value,
	onChange,
}: {
	entry: ExtensionCatalogEntry;
	setting: ExtensionSettingDescriptor;
	value: boolean;
	onChange: (value: boolean) => void;
}) {
	const t = useT();
	const copy = SETTING_COPY[entry.name]?.[setting.key];
	if (!copy) return null;
	return (
		<SettingsRow
			nested
			settingId={copy.settingId}
			rowId={`extension-setting-${entry.name}-${setting.key}`}
			testId={`extension-setting-${entry.name}-${setting.key}`}
			label={t(copy.title)}
			description={t(copy.description)}
			control={
				<Switch
					checked={value}
					disabled={!entry.enabled}
					label={t(copy.title)}
					testId={`extension-setting-toggle-${entry.name}-${setting.key}`}
					tabIndex={0}
					onCheckedChange={onChange}
				/>
			}
			reset={{
				changed: value !== setting.default,
				disabled: !entry.enabled,
				onReset: () => onChange(setting.default),
			}}
		/>
	);
}

function ToolsLine({ tools }: { tools: readonly string[] }) {
	const t = useT();
	if (tools.length === 0) return null;
	return (
		<span data-testid="extension-tools" className="wrap-anywhere">
			{t("settings.extensions.tools")}{" "}
			{tools.map((tool, index) => (
				<Fragment key={tool}>
					{index > 0 ? ", " : null}
					<code data-testid={`extension-tool-${tool}`} className="tr-code-text-small">
						{tool}
					</code>
				</Fragment>
			))}
		</span>
	);
}

export function ExtensionsCatalog({
	entries,
	disabled,
	onToggle,
	settings = {},
	onSetting,
	onRetry,
}: {
	entries: readonly ExtensionCatalogEntry[] | "loading" | "failed";
	disabled: readonly string[];
	onToggle: (name: string, enabled: boolean) => void;
	settings?: ExtensionSettingValues;
	onSetting?: ((name: string, key: string, value: boolean) => void) | undefined;
	onRetry?: (() => void) | undefined;
}) {
	const t = useT();
	if (entries === "loading") return <LoadingRegion rows={2} className="py-8" />;
	if (entries === "failed") {
		return (
			<SettingsNotice
				variant="error"
				testId="extensions-failed"
				action={
					onRetry ? (
						<Button
							variant="outline"
							size="s"
							tabIndex={0}
							data-testid="extensions-retry"
							onClick={onRetry}
						>
							{t("common.retry")}
						</Button>
					) : undefined
				}
			>
				{t("settings.extensions.loadFailed")}
			</SettingsNotice>
		);
	}
	if (entries.length === 0) {
		return (
			<p data-testid="extensions-empty" className="py-8 text-text-muted tr-text-metadata">
				{t("settings.extensions.empty")}
			</p>
		);
	}
	return (
		<div data-setting-id={SETTING.bundledExtensions.id} className={SETTINGS_ROWS}>
			{entries.map((entry) => {
				const enabled = !disabled.includes(entry.name);
				const title = extensionTitle(t, entry);
				const reset: SettingsReset = {
					changed: !enabled,
					onReset: () => onToggle(entry.name, true),
				};
				return (
					<Fragment key={entry.name}>
						<SettingsRow
							rowId={`extension-${entry.name}`}
							testId={`extension-row-${entry.name}`}
							label={title}
							description={
								entry.description || entry.tools.length > 0 ? (
									<span className="flex flex-col gap-2">
										{entry.description ? <span>{bundledDescription(t, entry)}</span> : null}
										<ToolsLine tools={entry.tools} />
									</span>
								) : undefined
							}
							control={
								<Switch
									checked={enabled}
									label={t("settings.extensions.enable", { title })}
									testId={`extension-toggle-${entry.name}`}
									tabIndex={0}
									onCheckedChange={(next) => onToggle(entry.name, next)}
								/>
							}
							reset={reset}
						/>
						{onSetting
							? (entry.settings ?? []).map((setting) => (
									<ExtensionSettingRow
										key={setting.key}
										entry={{ ...entry, enabled }}
										setting={setting}
										value={settings[entry.name]?.[setting.key] ?? setting.default}
										onChange={(value) => onSetting(entry.name, setting.key, value)}
									/>
								))
							: null}
					</Fragment>
				);
			})}
		</div>
	);
}

export function ExtensionsSettings() {
	const t = useT();
	const disabled = useAppStore((state) => state.disabledExtensions);
	const extensionSettings = useAppStore((state) => state.extensionSettings);
	const disabledPackages = useAppStore((state) => state.disabledPackages);
	const otherAgentSkills = useAppStore((state) => state.otherAgentSkills);
	const packagesVersion = useAppStore((state) => state.packagesVersion);
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const workspaceId = useAppStore(selectActiveRepoWorkspaceId);
	const packagesSupported = supportsPiPackages(protocolVersion);
	const settingsSupported = supportsExtensionSettings(protocolVersion);
	const [entries, setEntries] = useState<ExtensionCatalogEntry[] | "loading" | "failed">("loading");
	const [catalogAttempt, setCatalogAttempt] = useState(0);
	const [packagesAttempt, setPackagesAttempt] = useState(0);
	const [installOpen, setInstallOpen] = useState(false);
	const packages = usePiPackages({
		enabled: packagesSupported,
		workspaceId,
		packagesVersion: packagesVersion + packagesAttempt,
		disabledPackages,
	});

	useEffect(() => {
		let current = true;
		getTransport()
			.request("extension.list", {})
			.then((result) => {
				if (current) setEntries(result);
			})
			.catch(() => {
				if (current) setEntries("failed");
			});
		return () => {
			current = false;
		};
	}, [catalogAttempt]);

	const toggle = (name: string, enabled: boolean) => {
		const next = enabled
			? disabled.filter((candidate) => candidate !== name)
			: [...disabled.filter((candidate) => candidate !== name), name];
		getTransport()
			.request("settings.update", { config: { disabledExtensions: next } })
			.catch(() => toast.error(t("settings.extensions.changeFailed")));
	};

	const changeSetting = (name: string, key: string, value: boolean) => {
		getTransport()
			.request("settings.update", { config: { extensionSettings: { [name]: { [key]: value } } } })
			.catch(() => toast.error(t("settings.extensions.changeFailed")));
	};

	const { catalog, removeTarget } = packages;
	const loaded = catalog !== "loading" && catalog !== "failed" ? catalog : null;
	const settingsPath = loaded?.settingsPath ?? "";
	const projectSettingsPath = loaded?.projectSettingsPath;

	return (
		<SettingsPage
			testId="settings-extensions"
			title={t("settings.nav.extensions")}
			description={t(
				packagesSupported
					? "settings.extensions.description"
					: "settings.extensions.descriptionBundledOnly",
			)}
		>
			{packagesSupported ? (
				<SettingsGroup title={t("settings.extensions.group.packages")}>
					<SettingsRow
						{...settingProps(t, SETTING.installPackage)}
						control={
							<Button
								variant="primary"
								size="m"
								tabIndex={0}
								data-testid="packages-install"
								onClick={() => setInstallOpen(true)}
							>
								{t("settings.extensions.install")}
							</Button>
						}
						sides={<GalleryLink side />}
					/>
				</SettingsGroup>
			) : null}
			<SettingsGroup
				testId="settings-bundled-extensions"
				title={t("settings.extensions.group.bundled")}
			>
				<ExtensionsCatalog
					entries={Array.isArray(entries) ? withWebOnlyEntries(t, entries) : entries}
					disabled={disabled}
					onToggle={toggle}
					settings={extensionSettings}
					onSetting={settingsSupported ? changeSetting : undefined}
					onRetry={() => {
						setEntries("loading");
						setCatalogAttempt((value) => value + 1);
					}}
				/>
			</SettingsGroup>
			{packagesSupported ? (
				<PiPackagesGroup
					catalog={catalog}
					updates={packages.updates}
					checkingUpdates={packages.checkingUpdates}
					checkError={packages.errors.get(UPDATE_CHECK_KEY)}
					busy={packages.busy}
					errors={packages.errors}
					expanded={packages.expanded}
					onToggleExpanded={packages.toggleExpanded}
					onAction={packages.onAction}
					onUpdateAll={packages.updateAll}
					onCheckUpdates={packages.checkUpdates}
					onRetry={() => setPackagesAttempt((value) => value + 1)}
				/>
			) : null}
			{protocolVersion !== null && protocolVersion >= OTHER_AGENT_SKILLS_PROTOCOL_VERSION ? (
				<SettingsGroup
					testId="settings-other-agent-skills"
					title={t("settings.extensions.group.skills")}
				>
					<SettingsRow
						{...settingProps(t, SETTING.otherAgentSkills)}
						control={
							<Switch
								checked={otherAgentSkills}
								label={t("settings.extensions.otherAgentSkills")}
								testId="other-agent-skills-toggle"
								tabIndex={0}
								onCheckedChange={(enabled) =>
									void saveSettings(
										{ otherAgentSkills: enabled },
										t("settings.extensions.otherAgentSkillsFailed"),
									)
								}
							/>
						}
					/>
				</SettingsGroup>
			) : null}
			{packagesSupported && loaded ? (
				<PiBuiltinsGroup
					builtins={loaded.builtins}
					settingsPath={settingsPath}
					projectSettingsPath={projectSettingsPath}
					busy={packages.busy}
					errors={packages.errors}
					onToggle={packages.toggleBuiltin}
				/>
			) : null}
			{packagesSupported ? (
				<>
					<ConfirmDialog
						open={removeTarget !== null}
						onOpenChange={(open) => {
							if (!open) packages.cancelRemove();
						}}
						title={t("settings.packages.removeTitle", { name: removeTarget?.name ?? "" })}
						description={t("settings.packages.removeDescription", {
							path:
								removeTarget?.scope === "project"
									? (projectSettingsPath ?? settingsPath)
									: settingsPath,
						})}
						confirmLabel={t("settings.packages.removeConfirm")}
						destructive
						confirmTestId="package-remove-confirm"
						onConfirm={packages.removeNow}
					/>
					<InstallPackageDialog
						open={installOpen}
						onOpenChange={setInstallOpen}
						catalog={loaded}
						workspaceId={workspaceId ?? null}
						install={packages.install}
					/>
				</>
			) : null}
		</SettingsPage>
	);
}
