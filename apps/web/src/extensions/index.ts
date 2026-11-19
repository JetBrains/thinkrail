export { EXTENSION_API_VERSION, extensionApiFit } from "./compatibility";
export { followInstalledWebExtensions } from "./follow";
export { installExtensionHost } from "./host";
export { useWebExtensionLoads, type WebExtensionLoadResult } from "./loader";
export {
	enabledWebExtensions,
	registerWebExtensions,
	webExtensionCommands,
	webExtensions,
	webOnlyExtensions,
} from "./registry";
