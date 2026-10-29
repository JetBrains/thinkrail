export const LIVE_BLOCKS = {
	"color-alpha": "the alpha steps in `apps/web/src/styles/colors.json` (`scale`)",
	"color-roles": "every semantic role in `apps/web/src/styles/colors.json`",
	"color-palettes": "every palette key of every manifest in `apps/web/src/themes/bundled/`",
	"type-primitives": "the primitives in `apps/web/src/styles/typography.json`",
	"type-styles": "every semantic text style and its generated class, from `typography.json`",
	"type-counts": "the number of canonical and aliased styles in `typography.json`",
	"type-weights": "which style uses which weight, from `typography.json`",
	"prose-systems": "the element styles of every prose system in `typography.json`",
	"spacing-scale": "the steps in `apps/web/src/styles/spacing.json`",
	"layout-roles": "the layout roles declared in `apps/web/src/styles/tokens.css`",
	"radius-scale": "the radius steps declared in `apps/web/src/styles/tokens.css`",
	"icon-styles": "Line and Fill glyphs from `@remixicon/react`",
	"icon-tiers": "each icon size tier rendered with real glyphs",
	"custom-icons": "every glyph in `apps/web/public/custom-icons/`",
	themes: "every manifest in `apps/web/src/themes/bundled/`",
} as const;

export type LiveBlock = keyof typeof LIVE_BLOCKS;

export const LIVE_LINE = /^:::live\s+(\S+)\s*$/;

export function isLiveBlock(name: string): name is LiveBlock {
	return name in LIVE_BLOCKS;
}
