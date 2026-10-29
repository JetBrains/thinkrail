export interface StyleRef {
	$ref: string;
}

export interface FontFamily {
	stack: string[];
	kind: "proportional" | "monospace";
	selfHosted?: string[];
}

export interface Style {
	fontFamily: string;
	fontSize: string;
	fontWeight: string;
	lineHeight: string;
	letterSpacing: string;
	textTransform: "none" | "uppercase" | "lowercase" | "capitalize";
	fontStyle: "normal" | "italic";
}

export interface Typography {
	$schema: string;
	metadata: { version: string; cssVarPrefix: string; classPrefix: string };
	fontFamilies: Record<string, FontFamily | StyleRef>;
	fontWeights: Record<string, number>;
	fontSizes: Record<string, number>;
	lineHeights: Record<string, number>;
	letterSpacings: Record<string, string>;
	rootStyle: StyleRef;
	codeRow: { fontSize: string; lineHeight: string };
	textStyles: Record<string, Record<string, Style | StyleRef>>;
	proseSystems: Record<string, Record<string, Style | StyleRef>>;
}

export const isRef = (value: unknown): value is StyleRef =>
	typeof value === "object" && value !== null && "$ref" in value;

export const isProseGroup = (t: Typography, group: string): boolean =>
	group in (t.proseSystems ?? {});

export function rawStyle(t: Typography, id: string): Style | StyleRef | undefined {
	const [group, name] = id.split(".");
	if (!group || !name) return undefined;
	return isProseGroup(t, group) ? t.proseSystems[group]?.[name] : t.textStyles?.[group]?.[name];
}

export function resolveStyle(t: Typography, id: string): Style {
	const entry = rawStyle(t, id);
	if (!entry) throw new Error(`unknown style '${id}'`);
	if (!isRef(entry)) return entry;
	const target = rawStyle(t, entry.$ref);
	if (!target) throw new Error(`${id}: $ref to unknown style '${entry.$ref}'`);
	if (isRef(target))
		throw new Error(
			`${id}: $ref to '${entry.$ref}', which is itself a reference (chains are invalid)`,
		);
	return target;
}

export function resolveFamily(t: Typography, id: string): FontFamily {
	const entry = t.fontFamilies?.[id];
	if (!entry) throw new Error(`unknown font family '${id}'`);
	if (!isRef(entry)) return entry;
	const target = t.fontFamilies?.[entry.$ref];
	if (!target) throw new Error(`fontFamilies.${id}: $ref to unknown family '${entry.$ref}'`);
	if (isRef(target))
		throw new Error(
			`fontFamilies.${id}: $ref to '${entry.$ref}', which is itself a reference (chains are invalid)`,
		);
	return target;
}

const kebab = (id: string) => id.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

export function cssVarName(t: Typography, group: string, id: string): string {
	return `--${t.metadata.cssVarPrefix}-${group}-${kebab(id)}`;
}

export function styleClassName(t: Typography, group: string, id: string): string {
	const p = t.metadata.classPrefix;
	if (group === "ui") return id === "default" ? `${p}-text-ui` : `${p}-text-${kebab(id)}`;
	if (group === "body") return `${p}-text-${kebab(id)}`;
	return `${p}-${group}-${kebab(id)}`;
}

export function proseRootClassName(t: Typography, system: string): string {
	return `${t.metadata.classPrefix}-prose-${kebab(system)}`;
}

export const PROSE_STRONG_WEIGHT = "medium";

export const PROSE_SELECTORS: Record<string, string> = {
	body: "",
	h1: " h1",
	h2: " h2",
	h3: " h3",
	h4: " h4",
	h5: " h5",
	h6: " h6",
	inlineCode: " :not(pre) > code",
	codeBlock: " :is(pre, pre code)",
	blockquote: " blockquote",
	list: " :is(ul, ol, li)",
	tableBody: " :is(table, td)",
	tableHeader: " th",
	tableInlineCode: " :is(td, th) > code",
};

export const PROSE_CODE_NAMES = new Set(["inlineCode", "codeBlock", "tableInlineCode"]);

export const CODE_STYLE_IDS = new Set(["code.text", "code.document", "code.otp", "code.textSmall"]);

export function isCodeStyleId(t: Typography, id: string): boolean {
	const [group, name] = id.split(".");
	if (!group || !name) return false;
	return isProseGroup(t, group) ? PROSE_CODE_NAMES.has(name) : CODE_STYLE_IDS.has(id);
}

export interface ResolvedStyle {
	id: string;
	group: string;
	name: string;
	style: Style;
	ref: string | null;
	prose: boolean;
}

export function allStyles(t: Typography): ResolvedStyle[] {
	const out: ResolvedStyle[] = [];
	const push = (group: string, name: string, entry: Style | StyleRef, prose: boolean) => {
		const id = `${group}.${name}`;
		out.push({
			id,
			group,
			name,
			style: resolveStyle(t, id),
			ref: isRef(entry) ? entry.$ref : null,
			prose,
		});
	};
	for (const [group, styles] of Object.entries(t.textStyles))
		for (const [name, entry] of Object.entries(styles)) push(group, name, entry, false);
	for (const [system, styles] of Object.entries(t.proseSystems))
		for (const [name, entry] of Object.entries(styles)) push(system, name, entry, true);
	return out;
}
