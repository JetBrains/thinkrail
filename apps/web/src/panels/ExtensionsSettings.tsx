import type {
	ExtensionCatalogEntry,
	ExtensionSettingDescriptor,
	ExtensionSettingValues,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { type Translator, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { Switch } from "@thinkrail/ui/switch";
import { useEffect, useState } from "react";
import { selectActiveWorkspace, toast, useAppStore } from "@/store";
import { getTransport, supportsExtensionSettings, supportsPiPackages } from "@/transport";
import { ConfirmDialog } from "./ConfirmDialog";
import { InstallPackageDialog } from "./InstallPackageDialog";
import { PiBuiltinsGroup, PiPackagesGroup } from "./PiPackagesSettings";
import { UPDATE_CHECK_KEY, usePiPackages } from "./usePiPackages";

const BUNDLED_DESCRIPTIONS: Readonly<Record<string, MessageKey>> = {
	visualize: "settings.extensions.visualize.description",
	"web-access": "settings.extensions.web-access.description",
};

function bundledDescription(t: Translator, entry: ExtensionCatalogEntry): string {
	const key = BUNDLED_DESCRIPTIONS[entry.name];
	return key ? t(key) : (entry.description ?? "");
}

interface SettingCopy {
	title: MessageKey;
	description: MessageKey;
}

const SETTING_COPY: Readonly<Record<string, Readonly<Record<string, SettingCopy>>>> = {
	"ask-user-question": {
		richPreviews: {
			title: "settings.extensions.ask-user-question.richPreviews.title",
			description: "settings.extensions.ask-user-question.richPreviews.description",
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
		<div
			data-testid={`extension-setting-${entry.name}-${setting.key}`}
			className="flex items-start justify-between gap-12 border-border-default border-l-2 pl-12"
		>
			<div className="flex min-w-0 flex-col gap-2">
				<span
					className={
						entry.enabled ? "tr-text-ui text-text-default" : "tr-text-ui text-text-disabled"
					}
				>
					{t(copy.title)}
				</span>
				<span className="text-text-muted tr-text-metadata">{t(copy.description)}</span>
			</div>
			<Switch
				checked={value}
				disabled={!entry.enabled}
				label={t(copy.title)}
				testId={`extension-setting-toggle-${entry.name}-${setting.key}`}
				onCheckedChange={onChange}
			/>
		</div>
	);
}

export function ExtensionsCatalog({
	entries,
	disabled,
	onToggle,
	settings = {},
	onSetting,
}: {
	entries: readonly ExtensionCatalogEntry[] | "loading" | "failed";
	disabled: readonly string[];
	onToggle: (name: string, enabled: boolean) => void;
	settings?: ExtensionSettingValues;
	onSetting?: ((name: string, key: string, value: boolean) => void) | undefined;
}) {
	const t = useT();
	if (entries === "loading") return <LoadingRegion rows={2} className="py-8" />;
	if (entries === "failed" || entries.length === 0) {
		return (
			<p
				data-testid={entries === "failed" ? "extensions-failed" : "extensions-empty"}
				className="rounded-sm border border-border-default bg-container-elevated-bg px-12 py-8 text-text-muted tr-text-metadata"
			>
				{entries === "failed"
					? t("settings.extensions.loadFailed")
					: t("settings.extensions.empty")}
			</p>
		);
	}
	return (
		<ul className="flex flex-col divide-y divide-border-default rounded-sm border border-border-default bg-control-bg">
			{entries.map((entry) => {
				const enabled = !disabled.includes(entry.name);
				return (
					<li
						key={entry.name}
						data-testid={`extension-row-${entry.name}`}
						className="flex flex-col gap-8 px-12 py-8"
					>
						<div className="flex items-start justify-between gap-12">
							<div className="flex min-w-0 flex-col gap-4">
								<span className="tr-title-compact text-text-default">{entry.title}</span>
								{entry.description ? (
									<span className="text-text-muted tr-text-metadata">
										{bundledDescription(t, entry)}
									</span>
								) : null}
								{entry.tools.length > 0 ? (
									<span className="flex flex-wrap gap-4">
										{entry.tools.map((tool) => (
											<code
												key={tool}
												data-testid={`extension-tool-${tool}`}
												className="rounded-full bg-control-bg-selected px-8 text-text-muted tr-text-metadata"
											>
												{tool}
											</code>
										))}
									</span>
								) : null}
							</div>
							<Switch
								checked={enabled}
								label={t("settings.extensions.enable", { title: entry.title })}
								testId={`extension-toggle-${entry.name}`}
								onCheckedChange={(next) => onToggle(entry.name, next)}
							/>
						</div>
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
					</li>
				);
			})}
		</ul>
	);
}

export function ExtensionsSettings() {
	const t = useT();
	const disabled = useAppStore((state) => state.disabledExtensions);
	const extensionSettings = useAppStore((state) => state.extensionSettings);
	const disabledPackages = useAppStore((state) => state.disabledPackages);
	const packagesVersion = useAppStore((state) => state.packagesVersion);
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const workspaceId = useAppStore((state) => selectActiveWorkspace(state)?.id);
	const packagesSupported = supportsPiPackages(protocolVersion);
	const settingsSupported = supportsExtensionSettings(protocolVersion);
	const [entries, setEntries] = useState<ExtensionCatalogEntry[] | "loading" | "failed">("loading");
	const [installOpen, setInstallOpen] = useState(false);
	const packages = usePiPackages({
		enabled: packagesSupported,
		workspaceId,
		packagesVersion,
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
	}, []);

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
		<section data-testid="settings-extensions" className="flex flex-col gap-24">
			<div className="flex flex-wrap items-start justify-between gap-12">
				<div className="flex min-w-0 flex-1 flex-col gap-4">
					<h3 className="tr-title-section text-text-default">{t("settings.extensions.title")}</h3>
					<p className="text-text-muted tr-text-metadata">
						{t(
							packagesSupported
								? "settings.extensions.description"
								: "settings.extensions.descriptionBundledOnly",
						)}
					</p>
				</div>
				{packagesSupported ? (
					<Button
						variant="primary"
						size="m"
						data-testid="packages-install"
						onClick={() => setInstallOpen(true)}
					>
						{t("settings.extensions.install")}
					</Button>
				) : null}
			</div>
			<section data-testid="settings-bundled-extensions" className="flex flex-col">
				<h4 className="pb-8 tr-text-label-pill text-text-subtle">
					{t("settings.extensions.group.bundled")}
				</h4>
				<ExtensionsCatalog
					entries={entries}
					disabled={disabled}
					onToggle={toggle}
					settings={extensionSettings}
					onSetting={settingsSupported ? changeSetting : undefined}
				/>
			</section>
			{packagesSupported ? (
				<>
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
						onInstall={() => setInstallOpen(true)}
					/>
					{loaded ? (
						<PiBuiltinsGroup
							builtins={loaded.builtins}
							settingsPath={settingsPath}
							projectSettingsPath={projectSettingsPath}
							busy={packages.busy}
							errors={packages.errors}
							onToggle={packages.toggleBuiltin}
						/>
					) : null}
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
		</section>
	);
}
