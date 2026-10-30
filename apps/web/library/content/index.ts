import { button } from "./components/button";
import { collapsible } from "./components/collapsible";
import { diffStatBadge } from "./components/diff-stat-badge";
import { fileChip } from "./components/file-chip";
import { headerIconButton } from "./components/header-icon-button";
import { iconButton } from "./components/icon-button";
import { segmentedControl } from "./components/segmented-control";
import { settingsRadioCards } from "./components/settings-radio-cards";
import { settingsRow } from "./components/settings-row";
import { settingsSwitch } from "./components/settings-switch";
import { switchDoc } from "./components/switch";
import { tabStrip } from "./components/tab-strip";
import { textarea } from "./components/textarea";
import { toggleSegment } from "./components/toggle-segment";
import { treeRow } from "./components/tree-row";
import type { ComponentDoc, DocArea, DocPage } from "./types";

export type AreaId = DocArea | "components";

export const areas: readonly { area: AreaId; title: string }[] = [
	{ area: "guides", title: "Guides" },
	{ area: "foundations", title: "Foundations" },
	{ area: "components", title: "Components" },
	{ area: "patterns", title: "Patterns" },
	{ area: "vocabulary", title: "Vocabulary" },
];

export const docs: readonly DocPage[] = [
	{
		slug: "using",
		area: "guides",
		title: "Using the library",
		summary:
			"How the library is organised, the rules every UI change follows, and where things live.",
		file: "guides/using.md",
		sources: [],
	},
	{
		slug: "design-prompt",
		area: "guides",
		title: "Design iteration prompt",
		summary: "The prompt skeleton for trying visual changes with an agent.",
		file: "guides/design-prompt.md",
		sources: [],
	},
	{
		slug: "color",
		area: "foundations",
		title: "Color",
		summary: "Theme palettes, semantic roles and the alpha scale.",
		file: "foundations/color.md",
		sources: ["apps/web/src/themes/bundled/*.theme.json", "apps/web/src/styles/colors.json"],
		output: {
			path: "apps/web/src/styles/COLOR.md",
			heading: "Colour system",
			frontmatter: `id: web-color
type: submodule-design
status: active
title: ThinkRail colour — one JSON source, generated CSS, semantic roles
parent: module-web
depends-on: [submodule-web-themes]
references: [web-typography]`,
		},
	},
	{
		slug: "typography",
		area: "foundations",
		title: "Typography",
		summary: "Font families, primitives and the semantic text styles.",
		file: "foundations/typography.md",
		sources: ["apps/web/src/styles/typography.json"],
		output: {
			path: "apps/web/src/styles/TYPOGRAPHY.md",
			heading: "Typography system",
			frontmatter: `id: web-typography
type: submodule-design
status: active
title: ThinkRail typography — one JSON source, generated CSS, semantic styles
parent: module-web`,
		},
	},
	{
		slug: "spacing",
		area: "foundations",
		title: "Spacing",
		summary: "The canonical spacing scale and named layout roles.",
		file: "foundations/spacing.md",
		sources: ["apps/web/src/styles/spacing.json"],
		output: {
			path: "apps/web/src/styles/SPACING.md",
			heading: "Spacing system",
			frontmatter: `id: web-spacing
type: submodule-design
status: active
title: ThinkRail spacing — one JSON source, one canonical numeric scale
parent: module-web
references: [web-color, web-typography]`,
		},
	},
	{
		slug: "radius",
		area: "foundations",
		title: "Radius",
		summary: "Corner radius steps and which surfaces use them.",
		file: "foundations/radius.md",
		sources: ["apps/web/src/styles/tokens.css"],
	},
	{
		slug: "icons",
		area: "foundations",
		title: "Icons",
		summary: "Remix Icon, Line and Fill, sizes by context and project-custom glyphs.",
		file: "foundations/icons.md",
		sources: ["@remixicon/react", "apps/web/public/custom-icons/"],
	},
	{
		slug: "themes",
		area: "foundations",
		title: "Themes",
		summary: "Every bundled theme and the palette keys each one defines.",
		file: "foundations/themes.md",
		sources: ["apps/web/src/themes/bundled/*.theme.json"],
	},
	{
		slug: "notices",
		area: "patterns",
		title: "Notices",
		summary: "One look for toasts and inline banners.",
		file: "patterns/notices.md",
		sources: [],
		output: {
			path: "apps/web/src/styles/NOTIFICATIONS.md",
			heading: "In-app notices",
			frontmatter: `id: web-notices
type: submodule-design
status: active
title: ThinkRail in-app notices — one look for toasts and inline banners
parent: module-web
references: [web-color, web-spacing, web-typography]`,
		},
	},
	{
		slug: "loading",
		area: "patterns",
		title: "Loading",
		summary: "The two-tier loading vocabulary: skeletons for regions, spinners for controls.",
		file: "patterns/loading.md",
		sources: [],
	},
	{
		slug: "vocabulary",
		area: "vocabulary",
		title: "UI vocabulary",
		summary: "The canonical names of every region and element of the ThinkRail web UI.",
		file: "vocabulary/vocabulary.md",
		sources: [],
		output: { path: "apps/web/UI-TERMINOLOGY.md", heading: "ThinkRail UI Terminology Reference" },
	},
];

export const components: readonly ComponentDoc[] = [
	button,
	iconButton,
	headerIconButton,
	tabStrip,
	settingsSwitch,
	switchDoc,
	toggleSegment,
	segmentedControl,
	textarea,
	settingsRadioCards,
	settingsRow,
	diffStatBadge,
	fileChip,
	collapsible,
	treeRow,
];
