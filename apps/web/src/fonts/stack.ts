import type { FontChoice, FontFamilyRef, FontRole } from "@thinkrail/contracts";

export type BundledFaces = Readonly<Record<FontRole, string>>;

const GENERIC_FAMILIES = new Set([
	"serif",
	"sans-serif",
	"monospace",
	"cursive",
	"fantasy",
	"system-ui",
	"ui-serif",
	"ui-sans-serif",
	"ui-monospace",
	"ui-rounded",
	"emoji",
	"math",
	"fangsong",
]);

export function defaultStackVar(role: FontRole): string {
	return `var(--tr-font-family-${role}-default)`;
}

export function quoteFamily(name: string): string {
	return GENERIC_FAMILIES.has(name) ? name : `"${name}"`;
}

export function familiesOf(stack: string): string[] {
	return stack
		.split(",")
		.map((part) => part.trim().replace(/^(["'])(.*)\1$/, "$2"))
		.filter((part) => part.length > 0);
}

export function refFamily(ref: FontFamilyRef, faces: BundledFaces): string {
	return "builtin" in ref ? faces[ref.builtin] : ref.name;
}

export function roleFamily(ref: FontFamilyRef | null, role: FontRole, faces: BundledFaces): string {
	return ref ? refFamily(ref, faces) : faces[role];
}

export function namedFamilies(choices: readonly FontChoice[]): Set<string> {
	return new Set(
		choices.flatMap((choice) =>
			[choice.family, ...choice.fallbacks].flatMap((ref) =>
				ref !== null && "name" in ref ? [ref.name] : [],
			),
		),
	);
}

export function fontStack(choice: FontChoice, role: FontRole, faces: BundledFaces): string | null {
	if (choice.family === null && choice.fallbacks.length === 0) return null;
	const names = [
		roleFamily(choice.family, role, faces),
		...choice.fallbacks.map((ref) => refFamily(ref, faces)),
	];
	return [...new Set(names.filter((name) => name.length > 0))]
		.map(quoteFamily)
		.concat(defaultStackVar(role))
		.join(", ");
}

export function previewStack(family: string, role: FontRole): string {
	return `${quoteFamily(family)}, ${defaultStackVar(role)}`;
}
