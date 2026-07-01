// Defensive parsing of the `visualize` tool's `comparison` args (a `Record<string, unknown>` off the
// wire) into a typed view model the renderer can trust. Pure — unit-tested; no React/DOM.

/** A comparison option, normalized for rendering. Optional fields are always present but may be undefined. */
export interface ComparisonOptionView {
	name: string;
	description: string | undefined;
	pros: string[];
	cons: string[];
	recommended: boolean;
	mermaid: string | undefined;
}

function strArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Parse the `options` arg into view models. Non-arrays → `[]`; non-object entries → empty options. */
export function parseComparisonOptions(value: unknown): ComparisonOptionView[] {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => {
		const o = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
		return {
			name: typeof o.name === "string" ? o.name : "",
			description: typeof o.description === "string" ? o.description : undefined,
			pros: strArray(o.pros),
			cons: strArray(o.cons),
			recommended: o.recommended === true,
			mermaid: typeof o.mermaid === "string" ? o.mermaid : undefined,
		};
	});
}
