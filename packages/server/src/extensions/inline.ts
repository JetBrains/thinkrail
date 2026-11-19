import type {
	ExtensionFactory,
	InlineExtension,
	LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionSessionServices, ServerExtension } from "@thinkrail/extension-api/server";
import { EXTENSION_LOAD_TIMEOUT_MS } from "./installed";
import { type ServerExtensionEntry, serverExtensions } from "./registry";

export type RegistryExtensionKind = "extensions" | "childExtensions";
export type ExtensionDisabled = (name: string) => boolean;
export type HostSessionServices = Omit<ExtensionSessionServices, "setting">;
export type ExtensionSettingValue = (extension: string, key: string) => boolean | undefined;

const never: ExtensionDisabled = () => false;
const noValues: ExtensionSettingValue = () => undefined;
const INSTALLED_INLINE_PREFIX = "ext:";
const INLINE_PATH = new RegExp(`^<inline:(${INSTALLED_INLINE_PREFIX})?([^#>]+)(?:#\\d+)?>$`);

export function extensionSessionServices(
	extension: ServerExtension,
	host: HostSessionServices,
	settingValue: ExtensionSettingValue = noValues,
): ExtensionSessionServices {
	return {
		...host,
		setting: (key) => {
			const declared = extension.settings?.[key];
			if (!declared) throw new Error(`extension ${extension.name} has no setting "${key}"`);
			return settingValue(extension.name, key) ?? declared.default;
		},
	};
}

export function isFactoryList(value: unknown): value is ExtensionFactory[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "function");
}

/** A `sessionExtensions` answer that is not a list is dropped; a promise among them must not reject unobserved. */
export function dropAnswer(value: unknown): void {
	const then = (value as { then?: unknown } | null | undefined)?.then;
	if (typeof then === "function") {
		Promise.resolve(value).catch(() => undefined);
	}
}

/** `true` when `task` settles within the load timeout, `false` after it; a late rejection is observed, never thrown. */
export function settlesWithinLoadTimeout(task: Promise<unknown>): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => resolve(false), EXTENSION_LOAD_TIMEOUT_MS);
		task.then(
			() => {
				clearTimeout(timer);
				resolve(true);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

function failing(error: unknown): ExtensionFactory {
	return () => {
		throw error;
	};
}

function factoriesOf(
	entry: ServerExtensionEntry,
	kind: RegistryExtensionKind,
	session: HostSessionServices | undefined,
	settingValue: ExtensionSettingValue,
): ExtensionFactory[] {
	const { extension } = entry;
	if (kind === "childExtensions") return extension.childExtensions ?? [];
	if (!session || !extension.sessionExtensions) return [...extension.extensions];
	let perSession: unknown;
	try {
		perSession = extension.sessionExtensions(
			extensionSessionServices(extension, session, settingValue),
		);
	} catch (error) {
		return [...extension.extensions, failing(error)];
	}
	if (!isFactoryList(perSession)) {
		dropAnswer(perSession);
		return [
			...extension.extensions,
			failing(new Error(`${extension.name}: sessionExtensions must return a list of factories`)),
		];
	}
	return [...extension.extensions, ...perSession];
}

export function registryInlineExtensions(
	kind: RegistryExtensionKind,
	isDisabled: ExtensionDisabled = never,
	entries: readonly ServerExtensionEntry[] = serverExtensions(),
	session?: HostSessionServices,
	settingValue: ExtensionSettingValue = noValues,
): InlineExtension[] {
	return entries.flatMap((entry) => {
		const { name } = entry.extension;
		const inlineName = entry.installed ? `${INSTALLED_INLINE_PREFIX}${name}` : name;
		const factories = factoriesOf(entry, kind, session, settingValue);
		return factories.map((factory, index) => ({
			name: factories.length === 1 ? inlineName : `${inlineName}#${index + 1}`,
			factory: async (pi) => {
				if (isDisabled(name)) return;
				if (!entry.installed) return factory(pi);
				const loading = Promise.resolve().then(() => factory(pi));
				if (!(await settlesWithinLoadTimeout(loading))) {
					throw new Error(
						`${name} did not finish loading within ${EXTENSION_LOAD_TIMEOUT_MS / 1000} s`,
					);
				}
			},
		}));
	});
}

export function registryExtensionName(
	path: string,
	entries: readonly ServerExtensionEntry[] = serverExtensions(),
): string | undefined {
	const match = INLINE_PATH.exec(path);
	if (!match) return undefined;
	const installed = match[1] !== undefined;
	return entries.find(
		(entry) => (entry.installed !== undefined) === installed && entry.extension.name === match[2],
	)?.extension.name;
}

export function omitDisabledRegistryExtensions(
	result: LoadExtensionsResult,
	isDisabled: ExtensionDisabled,
	entries: readonly ServerExtensionEntry[] = serverExtensions(),
): LoadExtensionsResult {
	const kept = result.extensions.filter((extension) => {
		const name = registryExtensionName(extension.path, entries);
		return name === undefined || !isDisabled(name);
	});
	return kept.length === result.extensions.length ? result : { ...result, extensions: kept };
}

export function preferRegistryTools(
	result: LoadExtensionsResult,
	entries: readonly ServerExtensionEntry[] = serverExtensions(),
): LoadExtensionsResult {
	const builtins = entries.filter((entry) => !entry.installed);
	const isBuiltin = (path: string) => registryExtensionName(path, builtins) !== undefined;
	const ordered = [...result.extensions];
	for (const ours of result.extensions) {
		if (!isBuiltin(ours.path)) continue;
		const at = ordered.indexOf(ours);
		const rival = ordered.findIndex(
			(other, index) =>
				index < at &&
				!isBuiltin(other.path) &&
				[...other.tools.keys()].some((name) => ours.tools.has(name)),
		);
		if (rival < 0) continue;
		const span = ordered.slice(rival, at + 1);
		ordered.splice(
			rival,
			span.length,
			...span.filter((other) => isBuiltin(other.path)),
			...span.filter((other) => !isBuiltin(other.path)),
		);
	}
	return ordered.every((extension, index) => extension === result.extensions[index])
		? result
		: { ...result, extensions: ordered };
}
