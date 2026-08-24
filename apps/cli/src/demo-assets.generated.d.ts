// Type contract for the build-time-generated demo-assets module (`src/demo-assets.generated.ts`), which
// `bun run build:binary` writes just before `bun build --compile` and deletes afterward. This committed
// declaration keeps `compiled-entry.ts` typecheckable while the generated source is absent.

export interface EmbeddedDemoAsset {
	/** Path relative to the staged demo root, posix-style — e.g. `to-do-app/index.html`. */
	route: string;
	/** Embedded-file path (a Bun `import … with { type: "file" }`), readable at runtime via `Bun.file`. */
	data: string;
}

/** Every file under the bundled demo project templates, embedded into the single-file binary. */
export declare const embeddedDemoAssets: EmbeddedDemoAsset[];

/** Content hash of the embedded demo templates — keys the on-disk staging dir so a new build re-extracts. */
export declare const demoAssetsVersion: string;
