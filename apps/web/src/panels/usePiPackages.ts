import type {
	PiBuiltinExtension,
	PiPackageScope,
	PiPackageSummary,
	PiPackagesCatalog,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, getTransport } from "@/transport";
import { type PiPackageAction, piPackageKey } from "./PiPackagesSettings";

/** npm installs outlast the transport's default; the host still finishes a run that outlasts this. */
const PACKAGE_MUTATION_TIMEOUT_MS = 10 * 60_000;
/** An update check is a read that spawns `npm view` / `git ls-remote` per package. */
const UPDATE_CHECK_TIMEOUT_MS = 2 * 60_000;
/** The row key the update check's own failure renders under. */
export const UPDATE_CHECK_KEY = "\0check-updates";

export interface PiPackagesController {
	catalog: PiPackagesCatalog | "loading" | "failed";
	updates: ReadonlySet<string>;
	checkingUpdates: boolean;
	busy: ReadonlySet<string>;
	errors: ReadonlyMap<string, string>;
	expanded: ReadonlySet<string>;
	removeTarget: PiPackageSummary | null;
	toggleExpanded: (rowKey: string) => void;
	onAction: (action: PiPackageAction) => void;
	updateAll: () => void;
	checkUpdates: () => void;
	toggleBuiltin: (builtin: PiBuiltinExtension, enabled: boolean) => void;
	cancelRemove: () => void;
	removeNow: () => void;
	install: (request: { source: string; scope: PiPackageScope }) => Promise<PiPackageSummary>;
}

/** Every `packages.*` request of the Extensions page; list and check results apply only when still current. */
export function usePiPackages({
	enabled,
	workspaceId,
	packagesVersion,
	disabledPackages,
}: {
	enabled: boolean;
	workspaceId: string | undefined;
	packagesVersion: number;
	disabledPackages: readonly string[];
}): PiPackagesController {
	const t = useT();
	const [catalog, setCatalog] = useState<PiPackagesCatalog | "loading" | "failed">("loading");
	const [updates, setUpdates] = useState<ReadonlySet<string>>(new Set());
	const [checkingUpdates, setCheckingUpdates] = useState(false);
	const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
	const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const [removeTarget, setRemoveTarget] = useState<PiPackageSummary | null>(null);
	const listGeneration = useRef(0);
	const checkGeneration = useRef(0);
	const scoped = workspaceId ? { workspaceId } : {};

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
		if (!enabled) return;
		void listPackages();
	}, [listPackages, packagesVersion, enabled]);

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
			const generation = ++checkGeneration.current;
			const current = () => generation === checkGeneration.current;
			setCheckingUpdates(true);
			return getTransport()
				.request(
					"packages.checkUpdates",
					{ ...(workspaceId ? { workspaceId } : {}), ...(force ? { force: true } : {}) },
					{ timeoutMs: UPDATE_CHECK_TIMEOUT_MS },
				)
				.then((flagged) => {
					if (!current()) return;
					setUpdates(new Set(flagged.map(piPackageKey)));
					setErrors((errs) => {
						const next = new Map(errs);
						next.delete(UPDATE_CHECK_KEY);
						return next;
					});
				})
				.catch((error) => {
					if (!current()) return;
					setErrors((errs) =>
						new Map(errs).set(
							UPDATE_CHECK_KEY,
							errorText(error, t("settings.packages.checkUpdatesFailed")),
						),
					);
				})
				.finally(() => {
					if (current()) setCheckingUpdates(false);
				});
		},
		[workspaceId, t],
	);

	useEffect(() => {
		if (!enabled) return;
		void checkUpdates();
	}, [checkUpdates, enabled]);

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

	return {
		catalog,
		updates,
		checkingUpdates,
		busy,
		errors,
		expanded,
		removeTarget,
		toggleExpanded: (rowKey) =>
			setExpanded((current) => {
				const next = new Set(current);
				if (next.has(rowKey)) next.delete(rowKey);
				else next.add(rowKey);
				return next;
			}),
		onAction,
		updateAll: () => {
			if (catalog === "loading" || catalog === "failed") return;
			void updatePackages(catalog.packages.filter((summary) => updates.has(piPackageKey(summary))));
		},
		checkUpdates: () => void checkUpdates(true),
		toggleBuiltin: (builtin, enabled) => {
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
		},
		cancelRemove: () => setRemoveTarget(null),
		removeNow: () => {
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
		},
		install: (request) =>
			getTransport()
				.request(
					"packages.install",
					{ ...request, ...scoped },
					{ timeoutMs: PACKAGE_MUTATION_TIMEOUT_MS },
				)
				.then((summary) => {
					void listPackages();
					return summary;
				}),
	};
}
