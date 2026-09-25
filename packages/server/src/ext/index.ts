export { buildSurface } from "./build";
export { createExtDevTools, EXT_SDK_GUIDE } from "./devTools";
export type { ProjectRoot } from "./discovery";
export { projectExtensionsDir } from "./discovery";
export {
	createExtHost,
	type ExtHost,
	type ExtHostOptions,
	type ExtLogEntry,
	type ExtValidation,
} from "./host";
export { type ExtensionManifest, parseManifest } from "./manifest";
export type { SessionReads } from "./tr";
