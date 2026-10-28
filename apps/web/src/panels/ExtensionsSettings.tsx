import type {
	ExtensionCatalogEntry,
	PiPackageScope,
	PiPackageSummary,
	PiPackagesCatalog,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { type Translator, useT } from "@thinkrail/locales/react";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { Switch } from "@thinkrail/ui/switch";
import { useCallback, useEffect, useState } from "react";
import { selectActiveWorkspace, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { ConfirmDialog } from "./ConfirmDialog";
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
export const PACKAGE_MUTATION_TIMEOUT_MS = 10 * 60_000;

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

const updateKey = (target: { scope: PiPackageScope; source: string }) => piPackageKey(target);

export function ExtensionsSettings() {
	const t = useT();
	const disabled = useAppStore((state) => state.disabledExtensions);
	const disabledPackages = useAppStore((state) => state.disabledPackages);
	const packagesVersion = useAppStore((state) => state.packagesVersion);
	const workspaceId = useAppStore((state) => selectActiveWorkspace(state)?.id);
	const [entries, setEntries] = useState<ExtensionCatalogEntry[] | "loading" | "failed">("loading");
	const [catalog, setCatalog] = useState<PiPackagesCatalog | "loading" | "failed">("loading");
	const [updates, setUpdates] = useState<ReadonlySet<string>>(new Set());
	const [checkingUpdates, setCheckingUpdates] = useState(false);
	const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
	const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const [removeTarget, setRemoveTarget] = useState<PiPackageSummary | null>(null);

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
		return getTransport()
			.request("packages.list", workspaceId ? { workspaceId } : {})
			.then((result) => setCatalog(result))
			.catch(() => setCatalog("failed"));
	}, [workspaceId]);

	useEffect(() => {
		let current = true;
		getTransport()
			.request("packages.list", workspaceId ? { workspaceId } : {})
			.then((result) => {
				if (current) setCatalog(result);
			})
			.catch(() => {
				if (current) setCatalog("failed");
			});
		return () => {
			current = false;
		};
	}, [workspaceId, packagesVersion]);

	const checkUpdates = useCallback(() => {
		setCheckingUpdates(true);
		return getTransport()
			.request("packages.checkUpdates", workspaceId ? { workspaceId } : {}, {
				timeoutMs: PACKAGE_MUTATION_TIMEOUT_MS,
			})
			.then((flagged) => setUpdates(new Set(flagged.map(updateKey))))
			.catch(() => {})
			.finally(() => setCheckingUpdates(false));
	}, [workspaceId]);

	useEffect(() => {
		void checkUpdates();
	}, [checkUpdates]);

	const toggle = (name: string, enabled: boolean) => {
		const next = enabled
			? disabled.filter((candidate) => candidate !== name)
			: [...disabled.filter((candidate) => candidate !== name), name];
		getTransport()
			.request("settings.update", { config: { disabledExtensions: next } })
			.catch(() => toast.error(t("settings.extensions.changeFailed")));
	};

	const run = (
		rowKey: string,
		task: () => Promise<unknown>,
		failure: MessageKey,
		name?: string,
	) => {
		setBusy((current) => new Set([...current, rowKey]));
		setErrors((current) => {
			const next = new Map(current);
			next.delete(rowKey);
			return next;
		});
		return task()
			.then(() => listPackages())
			.catch((error) => {
				setErrors((current) =>
					new Map(current).set(rowKey, errorText(error, t(failure, { name }))),
				);
			})
			.finally(() => {
				setBusy((current) => {
					const next = new Set(current);
					next.delete(rowKey);
					return next;
				});
			});
	};

	const onAction = (action: PiPackageAction) => {
		const scoped = workspaceId ? { workspaceId } : {};
		switch (action.kind) {
			case "togglePackage": {
				const next = action.enabled
					? disabledPackages.filter((candidate) => candidate !== action.identity)
					: [
							...disabledPackages.filter((candidate) => candidate !== action.identity),
							action.identity,
						];
				getTransport()
					.request("settings.update", { config: { disabledPackages: next } })
					.catch(() => toast.error(t("settings.packages.actionFailed")));
				return;
			}
			case "toggleResource":
				void run(
					action.rowKey,
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
				void run(
					action.rowKey,
					() =>
						getTransport()
							.request(
								"packages.update",
								{ sources: [action.target.source], ...scoped },
								{ timeoutMs: PACKAGE_MUTATION_TIMEOUT_MS },
							)
							.then(() => checkUpdates()),
					"settings.packages.updateFailed",
					action.target.name,
				);
				return;
			case "reveal":
				getTransport()
					.request("packages.reveal", { path: action.path, ...scoped })
					.catch(() => toast.error(t("settings.packages.openFolderFailed")));
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
		const scoped = workspaceId ? { workspaceId } : {};
		void run(
			piPackageKey(target),
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
		for (const summary of catalog.packages) {
			const key = piPackageKey(summary);
			if (updates.has(key)) onAction({ kind: "update", rowKey: key, target: summary });
		}
	};

	const toggleBuiltin = (name: string, enabled: boolean) => {
		const scoped = workspaceId ? { workspaceId } : {};
		void run(
			`builtin:${name}`,
			() =>
				getTransport().request("packages.setResourceEnabled", {
					path: `builtin:${name}`,
					type: "extensions",
					scope: "user",
					enabled,
					...scoped,
				}),
			"settings.packages.actionFailed",
		);
	};

	const settingsPath = catalog !== "loading" && catalog !== "failed" ? catalog.settingsPath : "";

	return (
		<section data-testid="settings-extensions" className="flex flex-col gap-24">
			<div className="flex flex-wrap items-start justify-between gap-12">
				<div className="flex min-w-0 flex-1 flex-col gap-4">
					<h3 className="tr-title-section text-text-default">{t("settings.extensions.title")}</h3>
					<p className="text-text-muted tr-text-metadata">{t("settings.extensions.description")}</p>
				</div>
			</div>
			<section data-testid="settings-bundled-extensions" className="flex flex-col">
				<h4 className="pb-8 tr-text-label-pill text-text-subtle">
					{t("settings.extensions.group.bundled")}
				</h4>
				<ExtensionsCatalog entries={entries} disabled={disabled} onToggle={toggle} />
			</section>
			<PiPackagesGroup
				catalog={catalog}
				disabledPackages={disabledPackages}
				updates={updates}
				checkingUpdates={checkingUpdates}
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
				onCheckUpdates={() => void checkUpdates()}
			/>
			{catalog !== "loading" && catalog !== "failed" ? (
				<PiBuiltinsGroup
					builtins={catalog.builtins}
					settingsPath={settingsPath}
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
						removeTarget?.scope === "project" && catalog !== "loading" && catalog !== "failed"
							? (catalog.projectSettingsPath ?? settingsPath)
							: settingsPath,
				})}
				confirmLabel={t("settings.packages.removeConfirm")}
				destructive
				confirmTestId="package-remove-confirm"
				onConfirm={removeNow}
			/>
		</section>
	);
}
