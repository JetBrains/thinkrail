import type { ExtThemeMode, ExtThemeToken, ExtThemeTokens } from "@thinkrail/ext/view";

export const EXT_NAME = "themes";
export const DRAFT_KEY = "draft";

export const PALETTE_TOKENS = [
	"--accent",
	"--accent-hover",
	"--accent-solid",
	"--on-accent",
	"--bubble-accent",
	"--background",
	"--header",
	"--content",
	"--sidebar",
	"--input",
	"--elevated",
	"--hover",
	"--border",
	"--border-strong",
	"--text",
	"--muted",
	"--hint",
	"--selection",
	"--selection-foreground",
	"--editor-selection",
	"--editor-selection-foreground",
	"--info",
	"--success",
	"--danger",
	"--warning",
] as const satisfies readonly ExtThemeToken[];

export type PaletteToken = (typeof PALETTE_TOKENS)[number];

export const COLOR_FIELDS = [
	{ token: "--background", label: "Background" },
	{ token: "--sidebar", label: "Sidebar" },
	{ token: "--elevated", label: "Raised" },
	{ token: "--hover", label: "Hover" },
	{ token: "--border", label: "Border" },
	{ token: "--text", label: "Text" },
	{ token: "--muted", label: "Muted text" },
	{ token: "--accent", label: "Accent" },
	{ token: "--on-accent", label: "On accent" },
] as const satisfies readonly { token: PaletteToken; label: string }[];

export type ColorToken = (typeof COLOR_FIELDS)[number]["token"];

export const RADIUS_MIN = 0;
export const RADIUS_MAX = 16;
export const DEFAULT_RADIUS = 4;

export interface Draft {
	title: string;
	mode: ExtThemeMode;
	colors: Partial<Record<PaletteToken, string>>;
	radius: number;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const toHex = (value: string) => {
	const hex = value.trim().toLowerCase();
	return HEX.test(hex) ? hex : undefined;
};

export const toHex6 = (value: string) => {
	const hex = toHex(value);
	if (!hex) return undefined;
	if (hex.length === 4) return `#${[...hex.slice(1)].map((digit) => `${digit}${digit}`).join("")}`;
	return hex.slice(0, 7);
};

const clampRadius = (radius: number) =>
	Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, Math.round(radius)));

export const radiusTokens = (radius: number): ExtThemeTokens => {
	const sm = clampRadius(radius);
	return {
		"--radius-xs": `${Math.round(sm / 2)}px`,
		"--radius-sm": `${sm}px`,
		"--radius-md": `${Math.round(sm * 1.5)}px`,
		"--radius-lg": `${sm * 2}px`,
	};
};

export const draftTokens = (draft: Draft): ExtThemeTokens => ({
	...draft.colors,
	...radiusTokens(draft.radius),
});

export const slug = (title: string) =>
	title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/^(?![a-z])/, "t-") || "custom";

export const themeSnippet = (draft: Draft) =>
	JSON.stringify(
		{
			id: slug(draft.title),
			title: draft.title.trim() || "Custom",
			mode: draft.mode,
			tokens: draftTokens(draft),
		},
		null,
		2,
	);

const isPaletteToken = (token: string): token is PaletteToken =>
	PALETTE_TOKENS.some((known) => known === token);

export const parseDraft = (value: unknown): Draft | undefined => {
	if (typeof value !== "object" || value === null) return undefined;
	const { title, mode, colors, radius } = value as Record<string, unknown>;
	if (typeof title !== "string" || (mode !== "light" && mode !== "dark")) return undefined;
	if (typeof radius !== "number" || !Number.isFinite(radius)) return undefined;
	if (typeof colors !== "object" || colors === null) return undefined;
	const parsed: Partial<Record<PaletteToken, string>> = {};
	for (const [token, color] of Object.entries(colors)) {
		const hex = typeof color === "string" ? toHex(color) : undefined;
		if (isPaletteToken(token) && hex) parsed[token] = hex;
	}
	return { title: title.slice(0, 60), mode, colors: parsed, radius: clampRadius(radius) };
};

export const draftFromTokens = ({
	title,
	mode,
	tokens,
}: {
	title: string;
	mode: ExtThemeMode;
	tokens: Readonly<Record<string, string | undefined>>;
}): Draft => {
	const colors: Partial<Record<PaletteToken, string>> = {};
	for (const token of PALETTE_TOKENS) {
		const hex = toHex(tokens[token] ?? "");
		if (hex) colors[token] = hex;
	}
	const radius = Number.parseFloat(tokens["--radius-sm"] ?? "");
	return {
		title,
		mode,
		colors,
		radius: Number.isFinite(radius) ? clampRadius(radius) : DEFAULT_RADIUS,
	};
};

const HOVER_STEP = 0.14;
const SELECTION_ALPHA = "33";

const shade = (hex: string, amount: number) => {
	const target = amount < 0 ? 0 : 255;
	const weight = Math.abs(amount);
	const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
	return `#${channels
		.map((value) => Math.round(value + (target - value) * weight))
		.map((value) => value.toString(16).padStart(2, "0"))
		.join("")}`;
};

export const withColor = (draft: Draft, token: ColorToken, value: string): Draft => {
	const hex = toHex6(value);
	if (!hex) return draft;
	if (token !== "--accent") return { ...draft, colors: { ...draft.colors, [token]: hex } };
	return {
		...draft,
		colors: {
			...draft.colors,
			"--accent": hex,
			"--accent-solid": hex,
			"--bubble-accent": hex,
			"--accent-hover": shade(hex, draft.mode === "light" ? -HOVER_STEP : HOVER_STEP),
			"--selection": `${hex}${SELECTION_ALPHA}`,
			"--editor-selection": `${hex}${SELECTION_ALPHA}`,
		},
	};
};
