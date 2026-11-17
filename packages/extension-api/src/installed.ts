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

export const SHARED_SPECIFIERS = [
	"react",
	"react/jsx-runtime",
	"react-dom",
	"@thinkrail/extension-sdk/web",
	"@thinkrail/extension-sdk/resources",
	"@thinkrail/extension-sdk/ui/attention-line",
	"@thinkrail/extension-sdk/ui/button",
	"@thinkrail/extension-sdk/ui/dialog",
	"@thinkrail/extension-sdk/ui/fonts",
	"@thinkrail/extension-sdk/ui/keyboard",
	"@thinkrail/extension-sdk/ui/textarea",
	"@thinkrail/extension-sdk/ui/theme",
	"@thinkrail/extension-sdk/ui/utils",
] as const;

export type SharedSpecifier = (typeof SHARED_SPECIFIERS)[number];
