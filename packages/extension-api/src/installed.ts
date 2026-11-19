export {
	EXTENSION_API_VERSION,
	EXTENSION_KEYWORD,
	EXTENSION_MANIFEST_KEY,
	type ExtensionManifest,
	type ExtensionManifestOptions,
	type ExtensionManifestResult,
	extensionApiMismatch,
	hasExtensionManifest,
	isExtensionApiCompatible,
	normalizeManifestPath,
	parseExtensionManifest,
} from "./manifest";

export const EXTENSION_HOST_OBJECT = "__thinkrailExtensionHost";

export {
	SHARED_MODULE_EXPORTS,
	SHARED_SPECIFIERS,
	type SharedExportName,
	type SharedSpecifier,
} from "./sharedModules";
