// Type contract for the build-time-generated runtime-assets module (`src/runtime-assets.generated.ts`),
// which `bun run build:binary` writes before compilation and deletes afterward. This committed declaration
// keeps `compiled-entry.ts` typecheckable while the generated source is absent.

export interface EmbeddedRuntimeAsset {
	/** Filename relative to the staged runtime root (`macos-trash` or `windows-trash.exe`). */
	route: string;
	/** Embedded-file path, readable at runtime via `Bun.file`. */
	data: string;
}

/** Native helper sidecars embedded into the single-file binary and staged before host boot. */
export declare const embeddedRuntimeAssets: EmbeddedRuntimeAsset[];

/** Content hash of the helper bytes, used as the staging-directory version. */
export declare const runtimeAssetsVersion: string;
