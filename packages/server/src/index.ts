// The compiled-binary seam: a launcher that can't path-load the bundled pi extensions injects them
// as value-imported factories + a staged skills dir (see agent/SPEC.md).
export {
	type BundledExtensionFactory,
	type BundledExtensions,
	setBundledExtensions,
} from "./agent";
export * from "./host";
