export {
	EXTENSION_HOST_API,
	type ExtensionHost,
	installExtensionHost,
	SHARED_SPECIFIERS,
	type SharedSpecifier,
} from "./host";
export {
	type InstalledWebExtension,
	loadWebExtensions,
	loadWebExtensionsBeforeRender,
	PRE_RENDER_WAIT_MS,
	subscribeWebExtensionLoads,
	unloadWebExtension,
	useWebExtensionLoads,
	type WebExtensionLoadFailure,
	type WebExtensionLoadResult,
	webExtensionLoads,
} from "./loader";
export { registerWebExtensions, webExtensions } from "./registry";
