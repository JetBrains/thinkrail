// The compiled-binary seam: a launcher that can't path-load the bundled pi extensions injects them
// as value-imported factories + a staged skills dir (see agent/SPEC.md).
export {
	type BundledExtensionFactory,
	type BundledExtensions,
	registerBundledRuntime,
} from "./agent";
export * from "./host";
// Where our app state lives (`~/.thinkrail` unless `THINKRAIL_DATA_DIR`). Exposed for `thinkrail
// uninstall`, which has to name that dir — and must name the *same* one the host reads and writes.
export { dataDir } from "./persistence";
