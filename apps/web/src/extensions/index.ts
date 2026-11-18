export { EXTENSION_API_VERSION, type ExtensionApiFit, extensionApiFit } from "./compatibility";
export { followInstalledWebExtensions, type InstalledWebExtensionSource } from "./follow";
export { type ExtensionHost, installExtensionHost } from "./host";
export {
	type InstalledWebExtension,
	loadWebExtensions,
	loadWebExtensionsBeforeRender,
	PRE_RENDER_WAIT_MS,
	subscribeWebExtensionLoads,
	syncWebExtensions,
	unloadWebExtension,
	useWebExtensionLoads,
	type WebExtensionLoadFailure,
	type WebExtensionLoadResult,
	webExtensionLoads,
} from "./loader";
export {
	enabledWebExtensions,
	registerWebExtensions,
	type WebExtensionCommands,
	webExtensionCommands,
	webExtensions,
	webOnlyExtensions,
} from "./registry";
