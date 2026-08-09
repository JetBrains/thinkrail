import { readFileSync } from "node:fs";

/**
 * The faces the app ships, read from the generated typography CSS — the same stylesheet the browser
 * loads, and itself generated from `apps/web/src/styles/typography.json` (kept in step by
 * `typography:check`). Specs assert against these instead of a literal face name, so swapping a font
 * stays a one-file change in that JSON.
 *
 * The token is read rather than imported: `apps/web/scripts/typography.ts` uses `import.meta.dir`,
 * which is Bun-only, and Playwright runs under Node.
 */
const GENERATED = readFileSync(
	new URL("../../apps/web/src/styles/generated/typography.css", import.meta.url),
	"utf8",
);

/** The head of a family token's stack: the self-hosted face, the one that actually renders. */
function bundledFace(id: string): string {
	const match = GENERATED.match(new RegExp(`--tr-font-family-${id}:\\s*([^,;]+)`));
	if (!match) throw new Error(`--tr-font-family-${id} is not in the generated typography CSS`);
	return (match[1] as string).trim().replace(/^"|"$/g, "");
}

export const INTERFACE_FACE = bundledFace("interface");
export const CODE_FACE = bundledFace("code");
