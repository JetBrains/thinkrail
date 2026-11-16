// Type contract for the build-time-generated web-asset manifest (`src/sidecar/web-assets.generated.ts`),
// which `bun run scripts/build-sidecar.ts` writes just before `bun build --compile` and deletes afterward.
// This `.d.ts` is committed so `tsc` can resolve `desktop-sidecar-entry`'s import when the generated `.ts`
// is absent (the normal state in the repo); the compiler (`bun build`) uses the real `.ts` instead.

export interface EmbeddedWebAsset {
	/** Path relative to the web dist root, posix-style — e.g. `index.html` or `assets/app-abc123.js`. */
	route: string;
	/** Embedded-file path (a Bun `import … with { type: "file" }`), readable at runtime via `Bun.file`. */
	data: string;
}

/** Every file under `apps/web/dist`, embedded into the single-file sidecar. */
export declare const embeddedWebAssets: EmbeddedWebAsset[];

/** Content hash of the embedded build — keys the on-disk staging dir so a new build re-extracts. */
export declare const webAssetsVersion: string;
