import {
	type RemixiconComponentType,
	RiArrowDownSLine,
	RiArrowRightSLine,
	RiChat2Fill,
	RiChat2Line,
	RiDiscussFill,
	RiDiscussLine,
	RiFileFill,
	RiFileLine,
	RiFolder2Fill,
	RiFolder2Line,
	RiTaskFill,
	RiTaskLine,
	RiTerminalBoxLine,
} from "@remixicon/react";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import colorsJson from "@/styles/colors.json";
import spacingJson from "@/styles/spacing.json";
import tokensCss from "@/styles/tokens.css?raw";
import typographyJson from "@/styles/typography.json";
import type { Colors } from "../../scripts/colorsModel";
import {
	allStyles,
	proseRootClassName,
	styleClassName,
	type Typography,
} from "../../scripts/typographyModel";
import { InlineMarkdown } from "../parts/Markdown";
import { Table } from "../parts/Section";
import type { LiveBlock } from "./names";
import { layoutRoles, radiusSteps } from "./tokens";

const colors = colorsJson as unknown as Colors;
const typography = typographyJson as unknown as Typography;
const spacing = spacingJson as { steps: Record<string, string> };

interface Manifest {
	id: string;
	label: string;
	order: number;
	appearance: string;
	contrast: string;
	colors: Record<string, string | null>;
}
const manifests = Object.values(
	import.meta.glob<Manifest>("../../src/themes/bundled/*.theme.json", {
		eager: true,
		import: "default",
	}),
).sort((a, b) => a.order - b.order);

const customIcons = Object.entries(
	import.meta.glob<string>("../../public/custom-icons/*.svg", {
		eager: true,
		query: "?url",
		import: "default",
	}),
).map(([path, url]) => ({
	name:
		path
			.split("/")
			.pop()
			?.replace(/\.svg$/, "") ?? path,
	url,
}));

const swatch = (style: CSSProperties, label?: string) => (
	<span
		aria-hidden
		title={label}
		className="inline-block size-24 shrink-0 rounded-sm border border-border-default"
		style={style}
	/>
);
const code = (text: string) => <code className="whitespace-nowrap tr-code-text">{text}</code>;
const muted = (text: ReactNode) => <span className="tr-text-metadata text-text-muted">{text}</span>;

function ColorAlpha() {
	return (
		<Table
			head={["Step", "Alpha", "Accent at this step"]}
			rows={Object.entries(colors.scale).map(([step, percent]) => [
				code(step),
				`${percent}%`,
				swatch({ background: `color-mix(in srgb, var(--primary) ${percent}%, transparent)` }),
			])}
		/>
	);
}

function ColorRoles() {
	const roles = Object.entries(colors.roles);
	const effects = Object.entries(colors.effects);
	return (
		<div className="flex flex-col gap-12">
			{muted(
				`${roles.length} roles and ${effects.length} effects. Swatches are the live CSS variables of the current theme.`,
			)}
			<Table
				head={["", "Role", "From", "Alpha", "Note"]}
				rows={roles.map(([name, role]) => [
					swatch({ background: `var(--${name})` }, name),
					code(name),
					code(role.from),
					role.alpha ? code(role.alpha) : "—",
					muted(
						<InlineMarkdown
							source={[role.note, role.publish ? null : "variable only, no utility"]
								.filter(Boolean)
								.join(" · ")}
						/>,
					),
				])}
			/>
			<Table
				head={["", "Effect", "Dark", "Light", "Note"]}
				rows={effects.map(([name, effect]) => [
					swatch({ background: `var(--${name})` }, name),
					code(name),
					code(effect.dark),
					code(effect.light),
					effect.note ? muted(effect.note) : "",
				])}
			/>
		</div>
	);
}

function ColorPalettes() {
	const keys = [...new Set(manifests.flatMap((manifest) => Object.keys(manifest.colors)))];
	return (
		<Table
			head={["Key", ...manifests.map((manifest) => manifest.label)]}
			rows={keys.map((key) => [
				code(key),
				...manifests.map((manifest) => {
					const value = manifest.colors[key];
					return value ? (
						<span key={manifest.id} className="flex items-center gap-8">
							{swatch({ background: value }, value)}
							<span className="tr-code-text-small text-text-muted">{value}</span>
						</span>
					) : (
						muted("default")
					);
				}),
			])}
		/>
	);
}

function TypePrimitives() {
	const groups: [string, Record<string, string | number>][] = [
		["fontWeights", typography.fontWeights],
		[
			"fontSizes",
			Object.fromEntries(Object.entries(typography.fontSizes).map(([k, v]) => [k, `${v}px`])),
		],
		["lineHeights", typography.lineHeights],
		["letterSpacings", typography.letterSpacings],
	];
	return (
		<div className="flex flex-col gap-12">
			<Table
				head={["Family", "Stack", "Kind", "Self-hosted"]}
				rows={Object.entries(typography.fontFamilies).map(([id, family]) => [
					code(id),
					"$ref" in family ? muted(`→ ${family.$ref}`) : code(family.stack.join(", ")),
					"$ref" in family ? "" : family.kind,
					"$ref" in family ? "" : muted((family.selfHosted ?? []).join(", ")),
				])}
			/>
			<div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-12">
				{groups.map(([group, values]) => (
					<Table
						key={group}
						head={[group, "value"]}
						rows={Object.entries(values).map(([id, value]) => [code(id), code(String(value))])}
					/>
				))}
			</div>
		</div>
	);
}

function describe(style: ReturnType<typeof allStyles>[number]["style"]): string {
	return [
		style.fontFamily,
		`${typography.fontSizes[style.fontSize]}px`,
		typography.fontWeights[style.fontWeight],
		`lh ${typography.lineHeights[style.lineHeight]}`,
		style.letterSpacing !== "normal" ? typography.letterSpacings[style.letterSpacing] : null,
		style.textTransform !== "none" ? style.textTransform : null,
	]
		.filter(Boolean)
		.join(" · ");
}

function TypeStyles() {
	const styles = allStyles(typography).filter((entry) => !entry.prose);
	return (
		<Table
			head={["Class", "Sample", "Source", "Resolved"]}
			rows={styles.map((entry) => [
				code(`.${styleClassName(typography, entry.group, entry.name)}`),
				<span
					key="sample"
					className={`${styleClassName(typography, entry.group, entry.name)} text-text-default`}
				>
					The quick brown fox
				</span>,
				<span key="source" className="flex flex-col">
					{code(entry.id)}
					{entry.ref ? muted(`→ ${entry.ref}`) : null}
				</span>,
				muted(describe(entry.style)),
			])}
		/>
	);
}

function TypeCounts() {
	const styles = allStyles(typography);
	const canonical = styles.filter((entry) => !entry.ref).length;
	const prose = styles.filter((entry) => entry.prose).length;
	return (
		<Table
			head={["Canonical definitions", "Aliases ($ref)", "Styles", "Of which prose"]}
			rows={[
				[
					String(canonical),
					String(styles.length - canonical),
					String(styles.length),
					String(prose),
				],
			]}
		/>
	);
}

function TypeWeights() {
	const styles = allStyles(typography);
	return (
		<Table
			head={["Weight", "Value", "Used by"]}
			rows={Object.entries(typography.fontWeights).map(([id, value]) => [
				code(id),
				code(String(value)),
				muted(
					styles
						.filter((entry) => entry.style.fontWeight === id)
						.map((entry) => entry.id)
						.join(", ") || "—",
				),
			])}
		/>
	);
}

function ProseSystems() {
	const styles = allStyles(typography).filter((entry) => entry.prose);
	const systems = Object.keys(typography.proseSystems);
	const elements = [...new Set(styles.map((entry) => entry.name))];
	return (
		<Table
			head={[
				"Element",
				...systems.map((system) => `${system} (.${proseRootClassName(typography, system)})`),
			]}
			rows={elements.map((element) => [
				code(element),
				...systems.map((system) => {
					const entry = styles.find((style) => style.group === system && style.name === element);
					return entry ? (
						<span key={system} className="flex flex-col">
							{muted(describe(entry.style))}
							{entry.ref ? (
								<span className="tr-code-text-small text-text-subtle">→ {entry.ref}</span>
							) : null}
						</span>
					) : (
						"—"
					);
				}),
			])}
		/>
	);
}

function bar(value: string) {
	return (
		<span aria-hidden className="block h-12 rounded-xs bg-primary-muted" style={{ width: value }} />
	);
}

function SpacingScale() {
	return (
		<Table
			head={["Step", "Value", "Utilities", ""]}
			rows={Object.entries(spacing.steps).map(([step, value]) => [
				code(step),
				code(value),
				muted(`p-${step} · m-${step} · gap-${step}`),
				bar(value),
			])}
		/>
	);
}

function LayoutRoles() {
	const roles = layoutRoles(tokensCss);
	return (
		<Table
			head={["Variable", "Value", ""]}
			rows={roles.map((role) => [
				code(role.name),
				code(role.value),
				/^\d|var\(--space|calc/.test(role.value) && !role.value.includes("ms")
					? bar(`var(${role.name})`)
					: "",
			])}
		/>
	);
}

function RadiusScale() {
	return (
		<Table
			head={["Step", "Value", "Utility", ""]}
			rows={radiusSteps(tokensCss).map((step) => {
				const id = step.name.replace("--radius-", "");
				return [
					code(id),
					code(step.value),
					code(`rounded-${id}`),
					<span
						key="box"
						aria-hidden
						className="block h-32 w-64 border-2 border-primary bg-primary-subtle"
						style={{ borderRadius: `var(${step.name})` }}
					/>,
				];
			})}
		/>
	);
}

const PAIRS: [string, RemixiconComponentType, RemixiconComponentType][] = [
	["Folder", RiFolder2Line, RiFolder2Fill],
	["File", RiFileLine, RiFileFill],
	["Chat", RiChat2Line, RiChat2Fill],
	["Review", RiDiscussLine, RiDiscussFill],
	["Plan", RiTaskLine, RiTaskFill],
];

function IconStyles() {
	return (
		<Table
			head={["Glyph", "Line · default", "Fill · active / selected"]}
			rows={PAIRS.map(([name, Line, Fill]) => [
				name,
				<Line key="line" className="size-16 text-text-muted" />,
				<Fill key="fill" className="size-16 text-text-default" />,
			])}
		/>
	);
}

const TIER_SAMPLES: [string, RemixiconComponentType[]][] = [
	["size-12", [RiTerminalBoxLine, RiTaskLine]],
	["size-14", [RiTerminalBoxLine, RiTaskLine]],
	["size-16", [RiArrowRightSLine, RiArrowDownSLine]],
];

function IconTiers() {
	return (
		<Table
			head={["Class", "Rendered"]}
			rows={TIER_SAMPLES.map(([size, icons]) => [
				code(size),
				<span key="sample" className="flex items-center gap-8 text-text-default">
					{icons.map((Icon) => (
						<Icon key={Icon.displayName ?? Icon.name} className={size} />
					))}
				</span>,
			])}
		/>
	);
}

function CustomIcons() {
	return (
		<Table
			head={["Name", "Glyph", "File"]}
			rows={customIcons.map((icon) => [
				code(icon.name),
				<span
					key="glyph"
					aria-hidden
					className="custom-icon size-16 text-text-default"
					style={{ maskImage: `url("${icon.url}")`, WebkitMaskImage: `url("${icon.url}")` }}
				/>,
				muted(`public/custom-icons/${icon.name}.svg`),
			])}
		/>
	);
}

function Themes() {
	return (
		<div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-16">
			{manifests.map((manifest) => {
				const c = manifest.colors;
				return (
					<div
						key={manifest.id}
						className="flex flex-col overflow-hidden rounded-md border border-border-default"
					>
						<div
							className="flex flex-col gap-8 p-16"
							style={{ background: c.background ?? undefined, color: c.text ?? undefined }}
						>
							<span className="tr-title-section">{manifest.label}</span>
							<span className="tr-text-metadata" style={{ color: c.muted ?? undefined }}>
								Aa · muted text
							</span>
							<span className="flex gap-6">
								{[
									"accent",
									"accentSolid",
									"elevated",
									"border",
									"danger",
									"warning",
									"success",
									"info",
								].map((key) =>
									c[key] ? (
										<span
											key={key}
											title={`${key} ${c[key]}`}
											className="size-16 rounded-xs"
											style={{
												background: c[key] ?? undefined,
												outline: `1px solid ${c.border ?? "transparent"}`,
											}}
										/>
									) : null,
								)}
							</span>
						</div>
						<div className="flex flex-col gap-2 border-border-default border-t px-12 py-8">
							{code(manifest.id)}
							{muted(
								`${manifest.appearance} · ${manifest.contrast} contrast · ${Object.keys(c).length} keys`,
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}

export const liveBlocks: Record<LiveBlock, ComponentType> = {
	"color-alpha": ColorAlpha,
	"color-roles": ColorRoles,
	"color-palettes": ColorPalettes,
	"type-primitives": TypePrimitives,
	"type-styles": TypeStyles,
	"type-counts": TypeCounts,
	"type-weights": TypeWeights,
	"prose-systems": ProseSystems,
	"spacing-scale": SpacingScale,
	"layout-roles": LayoutRoles,
	"radius-scale": RadiusScale,
	"icon-styles": IconStyles,
	"icon-tiers": IconTiers,
	"custom-icons": CustomIcons,
	themes: Themes,
};
