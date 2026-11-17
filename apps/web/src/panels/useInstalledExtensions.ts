import type { ExtensionCatalogEntry } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, getTransport, refreshExtensionCatalog } from "@/transport";
import { type InstalledExtensionAction, installedExtensionKey } from "./InstalledExtensionRow";

/** An npm or git reinstall outlasts the transport's default; the host still finishes a run that outlasts this. */
const EXTENSION_MUTATION_TIMEOUT_MS = 10 * 60_000;
const UPDATE_CHECK_TIMEOUT_MS = 2 * 60_000;

export interface InstalledExtensionsController {
	/** `installedExtensionKey`s the last update check flagged. */
	updates: ReadonlySet<string>;
	checkingUpdates: boolean;
	checkError: string | undefined;
	busy: ReadonlySet<string>;
	errors: ReadonlyMap<string, string>;
	removeTarget: ExtensionCatalogEntry | null;
	onAction: (action: InstalledExtensionAction) => void;
	checkUpdates: () => void;
	updateFlagged: (entries: readonly ExtensionCatalogEntry[]) => void;
	cancelRemove: () => void;
	removeNow: () => void;
}

/** Off adds the name; on removes it. Names the page does not know are carried through. */
export function nextDisabledExtensions(
	current: readonly string[],
	name: string,
	enabled: boolean,
): string[] {
	const without = current.filter((candidate) => candidate !== name);
	return enabled ? without : [...without, name];
}

/** Every request an installed extension row makes; errors land on the row, never in a toast. */
export function useInstalledExtensions({
	enabled,
	disabledExtensions,
}: {
	enabled: boolean;
	disabledExtensions: readonly string[];
}): InstalledExtensionsController {
	const t = useT();
	const [updates, setUpdates] = useState<ReadonlySet<string>>(new Set());
	const [checkingUpdates, setCheckingUpdates] = useState(false);
	const [checkError, setCheckError] = useState<string | undefined>(undefined);
	const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
	const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
	const [removeTarget, setRemoveTarget] = useState<ExtensionCatalogEntry | null>(null);
	const checkGeneration = useRef(0);

	const checkUpdates = useCallback(
		(force: boolean) => {
			const generation = ++checkGeneration.current;
			const current = () => generation === checkGeneration.current;
			setCheckingUpdates(true);
			return getTransport()
				.request("extensions.checkUpdates", force ? { force: true } : {}, {
					timeoutMs: UPDATE_CHECK_TIMEOUT_MS,
				})
				.then((flagged) => {
					if (!current()) return;
					setUpdates(
						new Set(flagged.map(({ source }) => installedExtensionKey({ source, name: source }))),
					);
					setCheckError(undefined);
				})
				.catch((error: unknown) => {
					if (current()) setCheckError(errorText(error, t("settings.packages.checkUpdatesFailed")));
				})
				.finally(() => {
					if (current()) setCheckingUpdates(false);
				});
		},
		[t],
	);

	useEffect(() => {
		if (enabled) void checkUpdates(false);
	}, [checkUpdates, enabled]);

	const mark = (keys: readonly string[], on: boolean) =>
		setBusy((current) => {
			const next = new Set(current);
			for (const key of keys) {
				if (on) next.add(key);
				else next.delete(key);
			}
			return next;
		});

	const setRowError = (keys: readonly string[], message: string | null) =>
		setErrors((current) => {
			const next = new Map(current);
			for (const key of keys) {
				if (message === null) next.delete(key);
				else next.set(key, message);
			}
			return next;
		});

	const run = (
		entries: readonly ExtensionCatalogEntry[],
		task: () => Promise<unknown>,
		failure: MessageKey,
	) => {
		const keys = entries.map(installedExtensionKey);
		mark(keys, true);
		setRowError(keys, null);
		return task()
			.then(() => refreshExtensionCatalog())
			.catch((error: unknown) =>
				setRowError(
					keys,
					errorText(
						error,
						t(failure, { name: entries.length === 1 ? (entries[0]?.title ?? "") : "" }),
					),
				),
			)
			.finally(() => mark(keys, false));
	};

	const update = (entries: readonly ExtensionCatalogEntry[]) => {
		if (entries.length === 0) return Promise.resolve();
		return entries
			.reduce<Promise<unknown>>(
				(previous, entry) =>
					previous.then(() =>
						run(
							[entry],
							() =>
								getTransport().request(
									"extensions.update",
									{ source: entry.source ?? entry.name },
									{ timeoutMs: EXTENSION_MUTATION_TIMEOUT_MS },
								),
							"settings.packages.updateFailed",
						),
					),
				Promise.resolve(),
			)
			.then(() => checkUpdates(true));
	};

	const onAction = (action: InstalledExtensionAction) => {
		switch (action.kind) {
			case "toggle":
				void run(
					[action.entry],
					() =>
						getTransport().request("settings.update", {
							config: {
								disabledExtensions: nextDisabledExtensions(
									disabledExtensions,
									action.entry.name,
									action.enabled,
								),
							},
						}),
					"settings.extensions.changeFailed",
				);
				return;
			case "setting":
				void run(
					[action.entry],
					() =>
						getTransport().request("settings.update", {
							config: {
								extensionSettings: { [action.entry.name]: { [action.key]: action.value } },
							},
						}),
					"settings.extensions.changeFailed",
				);
				return;
			case "update":
				void update([action.entry]);
				return;
			case "remove":
				setRemoveTarget(action.entry);
				return;
		}
	};

	return {
		updates,
		checkingUpdates,
		checkError,
		busy,
		errors,
		removeTarget,
		onAction,
		checkUpdates: () => void checkUpdates(true),
		updateFlagged: (entries) =>
			void update(entries.filter((entry) => updates.has(installedExtensionKey(entry)))),
		cancelRemove: () => setRemoveTarget(null),
		removeNow: () => {
			const target = removeTarget;
			if (!target) return;
			setRemoveTarget(null);
			void run(
				[target],
				() =>
					getTransport()
						.request(
							"extensions.remove",
							{ source: target.source ?? target.name },
							{ timeoutMs: EXTENSION_MUTATION_TIMEOUT_MS },
						)
						.then(() =>
							setUpdates((current) => {
								const next = new Set(current);
								next.delete(installedExtensionKey(target));
								return next;
							}),
						),
				"settings.packages.removeFailed",
			);
		},
	};
}
