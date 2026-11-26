export const EXTENSION_API_VERSION = "1.0";

export const HOST_OBJECT = "__thinkrailExtensionHost";

export const SDK_PACKAGE = "@thinkrail/extension-sdk";

export const UI_MODULES = ["button", "theme", "utils"] as const;

export type UiModule = (typeof UI_MODULES)[number];

export const SHARED_SPECIFIERS = [
	"react",
	"react/jsx-runtime",
	"react-dom",
	`${SDK_PACKAGE}/web`,
	`${SDK_PACKAGE}/resources`,
	...UI_MODULES.map((name) => `${SDK_PACKAGE}/ui/${name}` as const),
] as const;

export type SharedSpecifier = (typeof SHARED_SPECIFIERS)[number];

export interface SharedModulesManifest {
	api: string;
	modules: Record<SharedSpecifier, string[]>;
}

export function apiMajor(version: string): string {
	return version.split(".")[0] ?? version;
}
