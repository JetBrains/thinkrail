import { EXT_THEME_TOKEN_GROUPS } from "./extThemeTokens.generated";

export { EXT_THEME_TOKEN_GROUPS };

export type ExtThemeTokenGroup = keyof typeof EXT_THEME_TOKEN_GROUPS;
export type ExtThemeToken = (typeof EXT_THEME_TOKEN_GROUPS)[ExtThemeTokenGroup][number];
export type ExtThemeTokens = Partial<Record<ExtThemeToken, string>>;

export const EXT_THEME_MODES = ["light", "dark"] as const;
export type ExtThemeMode = (typeof EXT_THEME_MODES)[number];

export interface ExtensionTheme {
	id: string;
	title: string;
	mode: ExtThemeMode;
	tokens: ExtThemeTokens;
	css: boolean;
}

export interface ExtThemeOverlay {
	mode: ExtThemeMode;
	tokens: ExtThemeTokens;
}

const TOKEN_GROUP = new Map<string, ExtThemeTokenGroup>(
	Object.entries(EXT_THEME_TOKEN_GROUPS).flatMap(([group, tokens]) =>
		tokens.map((token) => [token, group as ExtThemeTokenGroup] as const),
	),
);

export const EXT_THEME_TOKENS: readonly ExtThemeToken[] =
	Object.values(EXT_THEME_TOKEN_GROUPS).flat();

export const extThemeTokenGroup = (token: string) => TOKEN_GROUP.get(token);

export const isExtThemeToken = (token: string): token is ExtThemeToken => TOKEN_GROUP.has(token);

export const isExtThemeMode = (mode: unknown): mode is ExtThemeMode =>
	EXT_THEME_MODES.some((known) => known === mode);

export const extThemeKey = ({ name, id }: { name: string; id: string }) => `${name}/${id}`;

const MAX_VALUE_LENGTH = 200;
const FORBIDDEN = /[;{}<>\\@!]|url\(|image\(|image-set\(|expression\(/i;
const COLOR =
	/^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\([^()]*(?:\([^()]*\)[^()]*)*\)|var\(--[a-z0-9-]+\)|[a-z]+)$/i;
const LENGTH = /^(?:0|\d+(?:\.\d+)?(?:px|rem|em))$/;
const FONT = /^[\w\s,"'.-]+$/;

const VALUE_RULES: Record<ExtThemeTokenGroup, { pattern: RegExp; expected: string }> = {
	palette: { pattern: COLOR, expected: "a CSS color such as #1e1e2e or oklch(0.7 0.1 250)" },
	role: { pattern: COLOR, expected: "a CSS color such as #1e1e2e or oklch(0.7 0.1 250)" },
	radius: { pattern: LENGTH, expected: "a length such as 6px or 0.5rem" },
	font: { pattern: FONT, expected: 'a font-family list such as "Inter", sans-serif' },
};

const distance = (a: string, b: string) => {
	let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			current[j] = Math.min(
				(previous[j] ?? 0) + 1,
				(current[j - 1] ?? 0) + 1,
				(previous[j - 1] ?? 0) + cost,
			);
		}
		previous = current;
	}
	return previous[b.length] ?? 0;
};

const suggestToken = (token: string) => {
	const stripped = token.replace(/^--color-/, "--");
	if (isExtThemeToken(stripped)) return stripped;
	const [best] = EXT_THEME_TOKENS.map((known) => ({ known, cost: distance(stripped, known) })).sort(
		(a, b) => a.cost - b.cost,
	);
	return best && best.cost <= Math.max(3, Math.floor(stripped.length / 4)) ? best.known : undefined;
};

export const extThemeTokenError = (token: string, value: unknown) => {
	const group = extThemeTokenGroup(token);
	if (!group) {
		const suggestion = suggestToken(token);
		const hint = suggestion ? `did you mean "${suggestion}"? ` : "";
		return `unknown token; ${hint}allowed: ${Object.keys(EXT_THEME_TOKEN_GROUPS)
			.map((name) => `${name} tokens`)
			.join(", ")} (see the SDK README "Themes")`;
	}
	if (typeof value !== "string") return "value must be a string";
	const trimmed = value.trim();
	const rule = VALUE_RULES[group];
	if (
		trimmed === "" ||
		trimmed.length > MAX_VALUE_LENGTH ||
		FORBIDDEN.test(trimmed) ||
		!rule.pattern.test(trimmed)
	)
		return `value ${JSON.stringify(value)} is not ${rule.expected}`;
	return undefined;
};

export const extThemeTokensErrors = (tokens: Record<string, unknown>) =>
	Object.entries(tokens).flatMap(([token, value]) => {
		const error = extThemeTokenError(token, value);
		return error ? [{ token, error }] : [];
	});
