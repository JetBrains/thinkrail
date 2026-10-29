export interface CssVariable {
	name: string;
	value: string;
}

function declarations(block: string): CssVariable[] {
	return [...block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)]
		.map((match) => ({ name: match[1] ?? "", value: (match[2] ?? "").trim() }))
		.filter((entry) => !entry.name.endsWith("-*"));
}

function block(css: string, opener: RegExp): string {
	const start = css.search(opener);
	if (start < 0) return "";
	const open = css.indexOf("{", start);
	const close = css.indexOf("}", open);
	return css.slice(open + 1, close);
}

export function radiusSteps(tokensCss: string): CssVariable[] {
	return declarations(block(tokensCss, /@theme\s+static\s*\{/)).filter((entry) =>
		entry.name.startsWith("--radius-"),
	);
}

export function layoutRoles(tokensCss: string): CssVariable[] {
	const withoutComments = tokensCss.replace(/\/\*[\s\S]*?\*\//g, "");
	return declarations(block(withoutComments, /:root\s*\{/)).filter(
		(entry) => !entry.name.startsWith("--transition-"),
	);
}
