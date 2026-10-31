import { readFileSync } from "node:fs";

const GENERATED = readFileSync(
	new URL("../../apps/web/src/styles/generated/typography.css", import.meta.url),
	"utf8",
);

function bundledFace(id: string): string {
	const stack = (token: string) => GENERATED.match(new RegExp(`${token}:\\s*([^,;]+)`));
	const match = stack(`--tr-font-family-${id}-default`) ?? stack(`--tr-font-family-${id}`);
	if (!match) throw new Error(`--tr-font-family-${id} is not in the generated typography CSS`);
	return (match[1] as string).trim().replace(/^"|"$/g, "");
}

export const INTERFACE_FACE = bundledFace("interface");
export const CODE_FACE = bundledFace("code");
export const BRAND_FACE = bundledFace("brand");
