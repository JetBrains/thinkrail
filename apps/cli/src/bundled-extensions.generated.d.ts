// Type contract for the build-time-generated bundled-extensions module (`src/bundled-extensions.generated.ts`),
// which `bun run build:binary` writes just before `bun build --compile` and deletes afterward. This `.d.ts` is
// committed so `tsc` can resolve `compiled-entry`'s import when the generated `.ts` is absent (the normal
// state in the repo); the compiler (`bun build`) uses the real `.ts` instead.

import type { BundledExtensionFactory } from "@thinkrail/server";

/** The bundled pi extensions' default-export factories, value-imported, in load order. */
export declare const bundledExtensionFactories: BundledExtensionFactory[];

export interface EmbeddedSkillFile {
	/** Path relative to the staged skills root, posix-style — e.g. `spec-graph/SKILL.md`. */
	route: string;
	/** Embedded-file path (a Bun `import … with { type: "file" }`), readable at runtime via `Bun.file`. */
	data: string;
}

/** Every file under the bundled extensions' wired `skills/` dirs, embedded into the single-file binary. */
export declare const embeddedSkillFiles: EmbeddedSkillFile[];

/** Content hash of the embedded skills — keys the on-disk staging dir so a new build re-extracts. */
export declare const bundledSkillsVersion: string;
