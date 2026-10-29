import type {
	ExtensionCatalogEntry,
	PiBuiltinExtension,
	PiPackageSummary,
	PiPackagesCatalog,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { type Translator, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { Switch } from "@thinkrail/ui/switch";
import { useCallback, useEffect, useRef, useState } from "react";
import { selectActiveWorkspace, toast, useAppStore } from "@/store";
import { errorText, getTransport, supportsPiPackages } from "@/transport";
import { ConfirmDialog } from "./ConfirmDialog";
import { InstallPackageDialog } from "./InstallPackageDialog";
import {
	PiBuiltinsGroup,
	type PiPackageAction,
	PiPackagesGroup,
	piPackageKey,
} from "./PiPackagesSettings";

const BUNDLED_DESCRIPTIONS: Readonly<Record<string, MessageKey>> = {
	visualize: "settings.extensions.visualize.description",
	"web-access": "settings.extensions.web-access.description",
};

/** npm installs outlast the transport's default; the host still finishes a run that outlasts this. */
const PACKAGE_MUTATION_TIMEOUT_MS = 10 * 60_000;
/** An update check is a read that spawns `npm view` / `git ls-remote` per package. */
const UPDATE_CHECK_TIMEOUT_MS = 2 * 60_000;
/** The row key the update check's own failure renders under. */
const UPDATE_CHECK_KEY = "\0check-updates";

function bundledDescription(t: Translator, entry: ExtensionCatalogEntry): string {
	const key = BUNDLED_DESCRIPTIONS[entry.name];
	return key ? t(key) : (entry.description ?? "");
}

export function ExtensionsCatalog({
	entries,
	disabled,
	onToggle,
}: {
	entries: readonly ExtensionCatalogEntry[] | "loading" | "failed";
	disabled: readonly string[];
	onToggle: (name: string, enabled: boolean) => void;
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
						className="flex items-start justify-between gap-12 px-12 py-8"
					>
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
					</li>
				);
			})}
		</ul>
	);
}

export function ExtensionsSettings() {
	const t = useT();
	const disabled = useAppStore((state) => state.disabledExtensions);
	const disabledPackages = useAppStore((state) => state.disabledPackages);
	const packagesVersion = useAppStore((state) => state.packagesVersion);
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const workspaceId = useAppStore((state) => selectActiveWorkspace(state)?.id);
	const packagesSupported = supportsPiPackages(protocolVersion);
	const [entries, setEntries] = useState<ExtensionCatalogEntry[] | "loading" | "failed">("loading");
	const [catalog, setCatalog] = useState<PiPackagesCatalog | "loading" | "failed">("loading");
	const [updates, setUpdates] = useState<ReadonlySet<string>>(new Set());
	const [checkingUpdates, setCheckingUpdates] = useState(false);
	const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
	const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const [removeTarget, setRemoveTarget] = useState<PiPackageSummary | null>(null);
	const [installOpen, setInstallOpen] = useState(false);
	const scoped = workspaceId ? { workspaceId } : {};
	const listGeneration = useRef(0);

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

	const listPackages = useCallback(() => {
		const generation = ++listGeneration.current;
		return getTransport()
			.request("packages.list", workspaceId ? { workspaceId } : {})
			.then((result) => {
				if (generation === listGeneration.current) setCatalog(result);
			})
			.catch(() => {
				if (generation === listGeneration.current) setCatalog("failed");
			});
	}, [workspaceId]);

	useEffect(() => {
		if (!packagesSupported) return;
		void listPackages();
	}, [listPackages, packagesVersion, packagesSupported]);

	const setRowErrors = (keys: readonly string[], message: string | null) =>
		setErrors((current) => {
			const next = new Map(current);
			for (const key of keys) {
				if (message === null) next.delete(key);
				else next.set(key, message);
			}
			return next;
		});

	const checkUpdates = useCallback(
		(force = false) => {
			setCheckingUpdates(true);
			return getTransport()
				.request(
					"packages.checkUpdates",
					{ ...(workspaceId ? { workspaceId } : {}), ...(force ? { force: true } : {}) },
					{ timeoutMs: UPDATE_CHECK_TIMEOUT_MS },
				)
				.then((flagged) => {
					setUpdates(new Set(flagged.map(piPackageKey)));
					setErrors((current) => {
						const next = new Map(current);
						next.delete(UPDATE_CHECK_KEY);
						return next;
					});
				})
				.catch((error) => {
					setErrors((current) =>
						new Map(current).set(
							UPDATE_CHECK_KEY,
							errorText(error, t("settings.packages.checkUpdatesFailed")),
						),
					);
				})
				.finally(() => setCheckingUpdates(false));
		},
		[workspaceId, t],
	);

	useEffect(() => {
		if (!packagesSupported) return;
		void checkUpdates();
	}, [checkUpdates, packagesSupported]);

	const toggle = (name: string, enabled: boolean) => {
		const next = enabled
			? disabled.filter((candidate) => candidate !== name)
			: [...disabled.filter((candidate) => candidate !== name), name];
		getTransport()
			.request("settings.update", { config: { disabledExtensions: next } })
			.catch(() => toast.error(t("settings.extensions.changeFailed")));
	};

	const markBusy = (keys: readonly string[], on: boolean) =>
		setBusy((current) => {
			const next = new Set(current);
			for (const key of keys) {
				if (on) next.add(key);
				else next.delete(key);
			}
			return next;
		});

	const run = (
		rowKeys: readonly string[],
		task: () => Promise<unknown>,
		failure: MessageKey,
		name?: string,
	) => {
		markBusy(rowKeys, true);
		setRowErrors(rowKeys, null);
		return task()
			.then(() => listPackages())
			.catch((error) => setRowErrors(rowKeys, errorText(error, t(failure, { name }))))
			.finally(() => markBusy(rowKeys, false));
	};

	const updatePackages = (targets: readonly PiPackageSummary[]) => {
		if (targets.length === 0) return Promise.resolve();
		return run(
			targets.map(piPackageKey),
			() =>
				getTransport()
					.request(
						"packages.update",
						{ packages: targets.map(({ source, scope }) => ({ source, scope })), ...scoped },
						{ timeoutMs: PACKAGE_MUTATION_TIMEOUT_MS },
					)
					.then(() => checkUpdates(true)),
			"settings.packages.updateFailed",
			targets.length === 1 ? targets[0]?.name : undefined,
		);
	};

	const onAction = (action: PiPackageAction) => {
		switch (action.kind) {
			case "togglePackage": {
				const next = action.enabled
					? disabledPackages.filter((candidate) => candidate !== action.identity)
					: [
							...disabledPackages.filter((candidate) => candidate !== action.identity),
							action.identity,
						];
				void run(
					[action.rowKey],
					() => getTransport().request("settings.update", { config: { disabledPackages: next } }),
					"settings.packages.actionFailed",
				);
				return;
			}
			case "toggleResource":
				void run(
					[action.rowKey],
					() =>
						getTransport().request("packages.setResourceEnabled", {
							path: action.path,
							type: action.type,
							scope: action.scope,
							enabled: action.enabled,
							...scoped,
						}),
					"settings.packages.actionFailed",
				);
				return;
			case "update":
				void updatePackages([action.target]);
				return;
			case "reveal":
				void run(
					[action.rowKey],
					() => getTransport().request("packages.reveal", { path: action.path, ...scoped }),
					"settings.packages.openFolderFailed",
				);
				return;
			case "remove":
				setRemoveTarget(action.target);
				return;
		}
	};

	const removeNow = () => {
		const target = removeTarget;
		if (!target) return;
		setRemoveTarget(null);
		void run(
			[piPackageKey(target)],
			() =>
				getTransport().request(
					"packages.remove",
					{ source: target.source, scope: target.scope, ...scoped },
					{ timeoutMs: PACKAGE_MUTATION_TIMEOUT_MS },
				),
			"settings.packages.removeFailed",
			target.name,
		);
	};

	const updateAll = () => {
		if (catalog === "loading" || catalog === "failed") return;
		void updatePackages(catalog.packages.filter((summary) => updates.has(piPackageKey(summary))));
	};

	const toggleBuiltin = (builtin: PiBuiltinExtension, enabled: boolean) => {
		void run(
			[`builtin:${builtin.name}`],
			() =>
				getTransport().request("packages.setResourceEnabled", {
					path: `builtin:${builtin.name}`,
					type: "extensions",
					scope: builtin.scope,
					enabled,
					...scoped,
				}),
			"settings.packages.actionFailed",
		);
	};

	const settingsPath = catalog !== "loading" && catalog !== "failed" ? catalog.settingsPath : "";
	const projectSettingsPath =
		catalog !== "loading" && catalog !== "failed" ? catalog.projectSettingsPath : undefined;

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
				<ExtensionsCatalog entries={entries} disabled={disabled} onToggle={toggle} />
			</section>
			{packagesSupported ? (
				<>
					<PiPackagesGroup
						catalog={catalog}
						disabledPackages={disabledPackages}
						updates={updates}
						checkingUpdates={checkingUpdates}
						checkError={errors.get(UPDATE_CHECK_KEY)}
						busy={busy}
						errors={errors}
						expanded={expanded}
						onToggleExpanded={(key) =>
							setExpanded((current) => {
								const next = new Set(current);
								if (next.has(key)) next.delete(key);
								else next.add(key);
								return next;
							})
						}
						onAction={onAction}
						onUpdateAll={updateAll}
						onCheckUpdates={() => void checkUpdates(true)}
						onInstall={() => setInstallOpen(true)}
					/>
					{catalog !== "loading" && catalog !== "failed" ? (
						<PiBuiltinsGroup
							builtins={catalog.builtins}
							settingsPath={settingsPath}
							projectSettingsPath={projectSettingsPath}
							busy={busy}
							errors={errors}
							onToggle={toggleBuiltin}
						/>
					) : null}
					<ConfirmDialog
						open={removeTarget !== null}
						onOpenChange={(open) => {
							if (!open) setRemoveTarget(null);
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
						onConfirm={removeNow}
					/>
					<InstallPackageDialog
						open={installOpen}
						onOpenChange={setInstallOpen}
						catalog={catalog === "loading" || catalog === "failed" ? null : catalog}
						workspaceId={workspaceId ?? null}
						install={(request) =>
							getTransport()
								.request(
									"packages.install",
									{ ...request, ...scoped },
									{ timeoutMs: PACKAGE_MUTATION_TIMEOUT_MS },
								)
								.then((summary) => {
									void listPackages();
									return summary;
								})
						}
					/>
				</>
			) : null}
		</section>
	);
}
