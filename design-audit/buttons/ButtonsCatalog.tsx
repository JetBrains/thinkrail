// buttons.html: the shared button system only. Every specimen is the production Button / IconButton from
// packages/ui, styled by the production stylesheet; the catalog chrome uses `bk-*` classes only.
import {
	RiAddLine,
	RiArrowDownSLine,
	RiCheckLine,
	RiCloseLine,
	RiDeleteBinLine,
	RiEyeLine,
	RiKey2Line,
	RiLoginBoxLine,
	RiLogoutBoxLine,
	RiMore2Line,
} from "@remixicon/react";
import { Button, type ButtonSize, type ButtonVariant, IconButton } from "@thinkrail/ui/button";
import {
	Toast,
	ToastAction,
	ToastClose,
	ToastDescription,
	ToastProvider,
	ToastTitle,
	ToastViewport,
} from "@thinkrail/ui/toast";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { HeaderIconButton } from "@/panels/HeaderIconButton";
import {
	AuxiliaryRail,
	AuxiliaryRailToolButton,
	type AuxiliaryRailToolEntry,
} from "@/shell/layout";
import { applyTheme, getThemes, initializeBundledThemes } from "@/themes";
import type { ForcedPseudo } from "../catalog/pseudo";

initializeBundledThemes();

const VARIANTS: ButtonVariant[] = ["primary", "soft-primary", "outline", "ghost", "destructive"];
const SIZES: { id: ButtonSize; h: number; px: number; icon: number; gap: number }[] = [
	{ id: "s", h: 20, px: 4, icon: 14, gap: 4 },
	{ id: "m", h: 24, px: 8, icon: 16, gap: 4 },
	{ id: "l", h: 32, px: 12, icon: 20, gap: 6 },
];
const CONFIGS = ["text", "icon left + text", "text + icon right", "icon only"] as const;
type Config = (typeof CONFIGS)[number];
const SURFACES = [
	["bg-container-workspace-bg", "workspace"],
	["bg-container-sidebar-bg", "sidebar"],
	["bg-container-elevated-bg", "elevated (dialogs, menus)"],
	["bg-container-header-bg", "header"],
] as const;

// ---------- colour + contrast from computed styles ----------
type RGBA = [number, number, number, number];
function parseColor(v: string): RGBA | null {
	let m = v.match(/rgba?\(([^)]+)\)/);
	if (m) {
		const p = m[1]
			.split(/[ ,/]+/)
			.filter(Boolean)
			.map(Number);
		return [p[0], p[1], p[2], p[3] ?? 1];
	}
	m = v.match(/color\(srgb ([^)]+)\)/);
	if (m) {
		const p = m[1].split(/[ /]+/).filter(Boolean).map(Number);
		return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1];
	}
	return null;
}
const over = (top: RGBA, under: RGBA): RGBA => {
	const a = top[3];
	return [
		top[0] * a + under[0] * (1 - a),
		top[1] * a + under[1] * (1 - a),
		top[2] * a + under[2] * (1 - a),
		1,
	];
};
const lum = (c: RGBA) =>
	[c[0], c[1], c[2]]
		.map((x) => x / 255)
		.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
		.reduce((acc, x, i) => acc + x * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a: RGBA, b: RGBA) => {
	const [x, y] = [lum(a), lum(b)];
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

export interface Measurement {
	height: number;
	width: number;
	paddingX: string;
	gap: string;
	icon: string;
	border: string;
	radius: string;
	text: number | null;
	focus: number | null;
	outline: string;
}

function measureButton(el: HTMLElement, stage: HTMLElement): Measurement {
	const cs = getComputedStyle(el);
	const r = el.getBoundingClientRect();
	const svg = el.querySelector("svg");
	const surface = parseColor(getComputedStyle(stage).backgroundColor) ?? [0, 0, 0, 1];
	const bg = parseColor(cs.backgroundColor);
	const fg = parseColor(cs.color);
	const effectiveBg = bg ? over(bg, surface) : surface;
	const text = fg ? Math.round(ratio(over(fg, effectiveBg), effectiveBg) * 100) / 100 : null;
	const oc = parseColor(cs.outlineColor);
	const focus =
		cs.outlineStyle !== "none" && oc
			? Math.round(ratio(over(oc, surface), surface) * 100) / 100
			: null;
	return {
		height: Math.round(r.height * 100) / 100,
		width: Math.round(r.width * 100) / 100,
		paddingX: `${cs.paddingLeft} ${cs.paddingRight}`,
		gap: cs.gap === "normal" ? "0" : cs.gap,
		// computed (layout) size, not the bounding box: a spinning loader's rotated box is larger than the icon
		icon: svg ? getComputedStyle(svg).width.replace(/\.\d+/, "") : "—",
		border: `${cs.borderTopWidth} ${cs.borderTopStyle}`,
		radius: cs.borderRadius,
		text,
		focus,
		outline:
			cs.outlineStyle === "none"
				? "none"
				: `${cs.outlineWidth} ${cs.outlineStyle} offset ${cs.outlineOffset}`,
	};
}

// ---------- specimen frame ----------
interface Spec {
	id: string;
	label: string;
	size: (typeof SIZES)[number];
	force?: ForcedPseudo[];
	render: () => ReactNode;
	expect?: "text" | "icon";
}
const REPORT: Record<string, Measurement & { theme: string; size: string; expect?: string }> = {};
(window as unknown as { __BTN_REPORT__: typeof REPORT }).__BTN_REPORT__ = REPORT;

function Specimen({ s, theme, surface }: { s: Spec; theme: string; surface: string }) {
	const stage = useRef<HTMLDivElement>(null);
	const [m, setM] = useState<Measurement | null>(null);
	useLayoutEffect(() => {
		const root = stage.current;
		if (!root) return;
		let t = 0;
		let raf = requestAnimationFrame(() => {
			raf = requestAnimationFrame(() => {
				const el = root.querySelector<HTMLElement>('[data-slot="button"]');
				if (!el) return;
				for (const p of s.force ?? []) el.classList.add(`dsa-force-${p}`);
				t = window.setTimeout(() => {
					const res = measureButton(el, root);
					REPORT[s.id] = {
						...res,
						theme,
						size: s.size.id,
						...(s.expect ? { expect: s.expect } : {}),
					};
					setM(res);
				}, 400);
			});
		});
		return () => {
			cancelAnimationFrame(raf);
			clearTimeout(t);
		};
	}, [theme, surface, s]);
	const g = s.size;
	const geometryOk =
		m &&
		m.height === g.h &&
		(s.expect !== "icon" || m.width === g.h) &&
		(s.expect !== "text" || m.paddingX === `${g.px}px ${g.px}px`);
	return (
		<figure className="bk-spec" data-bk-spec={s.id}>
			<div ref={stage} className={`bk-stage ${surface}`}>
				{s.render()}
			</div>
			<figcaption className="bk-cap">
				<div className="bk-cap-label">{s.label}</div>
				{s.force?.length ? (
					<div className="bk-forced">forced :{s.force.join(" :")} (rule-rewrite fixture)</div>
				) : null}
				{m ? (
					<div className={geometryOk ? "bk-measure" : "bk-measure bk-bad"}>
						{m.width}×{m.height} · px {m.paddingX.split(" ")[0]} · gap {m.gap} · icon {m.icon}
						{m.text !== null ? ` · text ${m.text}:1` : ""}
						{m.focus !== null ? ` · focus ${m.focus}:1` : ""}
					</div>
				) : (
					<div className="bk-measure">measuring…</div>
				)}
			</figcaption>
		</figure>
	);
}

function content(
	variant: ButtonVariant,
	size: ButtonSize,
	config: Config,
	extra: Record<string, unknown> = {},
) {
	const label =
		variant === "destructive" ? "Remove" : variant === "soft-primary" ? "Sign in" : "Action";
	if (config === "icon only")
		return (
			<IconButton
				variant={variant}
				size={size}
				icon={variant === "destructive" ? RiDeleteBinLine : RiAddLine}
				label={`${label} (icon)`}
				{...extra}
			/>
		);
	return (
		<Button
			variant={variant}
			size={size}
			{...(config === "icon left + text"
				? { iconLeft: variant === "destructive" ? RiDeleteBinLine : RiAddLine }
				: {})}
			{...(config === "text + icon right" ? { iconRight: RiArrowDownSLine } : {})}
			{...extra}
		>
			{label}
		</Button>
	);
}

const STATES: {
	id: string;
	force?: ForcedPseudo[];
	props?: Record<string, unknown>;
	only?: ButtonVariant[];
}[] = [
	{ id: "default" },
	{ id: "hover", force: ["hover"] },
	{ id: "pressed", force: ["active", "hover"] },
	{ id: "focus-visible", force: ["focus-visible"] },
	{ id: "disabled", props: { disabled: true } },
	{ id: "loading", props: { loading: true } },
	{ id: "selected", props: { selected: true }, only: ["outline", "ghost"] },
];

const PRESS_STATES: {
	id: string;
	label: string;
	force?: ForcedPseudo[];
	props?: Record<string, unknown>;
}[] = [
	{ id: "rest", label: "rest" },
	{ id: "hover", label: "hover", force: ["hover"] },
	{ id: "pressed", label: "pressed (:active, transient)", force: ["active", "hover"] },
	{ id: "selected", label: "selected (persistent)", props: { selected: true } },
	{ id: "selected-hover", label: "selected + hover", force: ["hover"], props: { selected: true } },
	{
		id: "selected-pressed",
		label: "selected + pressed",
		force: ["active", "hover"],
		props: { selected: true },
	},
];

const railEntry = (
	tool: AuxiliaryRailToolEntry["tool"],
	open: boolean,
): AuxiliaryRailToolEntry => ({
	key: `bk-${tool}`,
	region: "left",
	kind: "tool",
	groupId: null,
	tool,
	tab: null,
	selected: open,
	expanded: open,
});
const RAIL_ENTRIES: AuxiliaryRailToolEntry[] = [
	railEntry("projects", true),
	railEntry("files", false),
	railEntry("changes", false),
	railEntry("review", false),
];

export function ButtonsCatalog({ forcedRules }: { forcedRules: number }) {
	const themes = getThemes();
	const [theme, setTheme] = useState(
		() => new URLSearchParams(location.search).get("theme") ?? "dark",
	);
	const [surface, setSurface] = useState<string>(SURFACES[0][0]);
	const [clicks, setClicks] = useState(0);
	const [busy, setBusy] = useState(false);
	useLayoutEffect(() => {
		applyTheme(theme);
	}, [theme]);
	return (
		<div className="bk-app">
			<header className="bk-top">
				<div>
					<div className="bk-title">ThinkRail buttons</div>
					<div className="bk-sub">
						packages/ui/button.tsx — Button &amp; IconButton · 5 variants × 3 sizes × 4 content
						configurations · production stylesheet · {forcedRules} forced-state rules
					</div>
				</div>
				<label className="bk-field">
					Theme
					<select data-testid="bk-theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
						{themes.map((t) => (
							<option key={t.id} value={t.id}>
								{t.label}
							</option>
						))}
					</select>
				</label>
				<label className="bk-field">
					Stage surface
					<select value={surface} onChange={(e) => setSurface(e.target.value)}>
						{SURFACES.map(([cls, name]) => (
							<option key={cls} value={cls}>
								{name}
							</option>
						))}
					</select>
				</label>
				<nav className="bk-nav">
					<a href="#matrix">Matrix</a>
					<a href="#states">States</a>
					<a href="#pressed-selected">Pressed / selected</a>
					<a href="#interactive">Interactive</a>
					<a href="#exemplars">Exemplars</a>
					<a href="#api">API</a>
				</nav>
			</header>

			<section id="sizes" className="bk-section">
				<h2>Sizes</h2>
				<table className="bk-table">
					<thead>
						<tr>
							<th>Size</th>
							<th>Height</th>
							<th>Text padding (x)</th>
							<th>Icon</th>
							<th>Icon ↔ text gap</th>
							<th>Icon-only</th>
							<th>Radius</th>
							<th>Type</th>
						</tr>
					</thead>
					<tbody>
						{SIZES.map((g) => (
							<tr key={g.id}>
								<td>
									<code>size="{g.id}"</code>
								</td>
								<td>{g.h}px</td>
								<td>{g.px}px</td>
								<td>{g.icon}px</td>
								<td>{g.gap}px</td>
								<td>
									{g.h} × {g.h}px
								</td>
								<td>4px</td>
								<td>
									<code>tr-text-button</code> (14px · 470)
								</td>
							</tr>
						))}
					</tbody>
				</table>
				<p className="bk-note">
					Measured values under every specimen come from the rendered element in the selected theme
					(border-box). A red line means the measurement differs from this table.
				</p>
			</section>

			<section id="matrix" className="bk-section">
				<h2>Matrix — 5 variants × 3 sizes × 4 configurations (60 specimens)</h2>
				{VARIANTS.map((variant) => (
					<div key={variant} className="bk-variant" data-bk-variant={variant}>
						<h3>
							<code>variant="{variant}"</code>
						</h3>
						{SIZES.map((g) => (
							<div key={g.id} className="bk-row">
								<div className="bk-row-head">
									<b>{g.id.toUpperCase()}</b> {g.h}px · px {g.px} · icon {g.icon} · gap {g.gap}
								</div>
								<div className="bk-cells">
									{CONFIGS.map((config) => (
										<Specimen
											key={config}
											theme={theme}
											surface={surface}
											s={{
												id: `matrix:${variant}:${g.id}:${config}`,
												label: config,
												size: g,
												expect:
													config === "icon only" ? "icon" : config === "text" ? "text" : undefined,
												render: () => content(variant, g.id, config),
											}}
										/>
									))}
								</div>
							</div>
						))}
					</div>
				))}
			</section>

			<section id="states" className="bk-section">
				<h2>States — every variant and size</h2>
				<p className="bk-note">
					Hover, pressed and focus-visible are forced with the documented fixture (every production
					rule with that pseudo-class is duplicated onto a marker class). Disabled, loading and
					selected are real props. Selected (persistent: toggles, open menus) exists only on outline
					and ghost and is distinct from transient pressed.
				</p>
				{VARIANTS.map((variant) => (
					<div key={variant} className="bk-variant">
						<h3>
							<code>variant="{variant}"</code>
						</h3>
						{SIZES.map((g) => (
							<div key={g.id} className="bk-row">
								<div className="bk-row-head">
									<b>{g.id.toUpperCase()}</b>
								</div>
								<div className="bk-cells">
									{STATES.filter((st) => !st.only || st.only.includes(variant)).map((st) => (
										<Specimen
											key={st.id}
											theme={theme}
											surface={surface}
											s={{
												id: `state:${variant}:${g.id}:${st.id}`,
												label: st.id,
												size: g,
												force: st.force,
												render: () => content(variant, g.id, "icon left + text", st.props),
											}}
										/>
									))}
									<Specimen
										theme={theme}
										surface={surface}
										s={{
											id: `state:${variant}:${g.id}:loading-text`,
											label: "loading (text only)",
											size: g,
											render: () => content(variant, g.id, "text", { loading: true }),
										}}
									/>
									<Specimen
										theme={theme}
										surface={surface}
										s={{
											id: `state:${variant}:${g.id}:loading-icon`,
											label: "loading (icon only)",
											size: g,
											expect: "icon",
											render: () => content(variant, g.id, "icon only", { loading: true }),
										}}
									/>
								</div>
							</div>
						))}
					</div>
				))}
			</section>

			<section id="pressed-selected" className="bk-section">
				<h2>Pressed vs selected</h2>
				<p className="bk-note">
					Pressed is transient (pointer down, or Space held on a focused button) and looks exactly
					like hover in every variant: the <code>active:</code> classes mirror the{" "}
					<code>hover:</code> ones, so a keyboard press without a pointer shows it too; border and
					geometry do not change. Selected is persistent (<code>selected</code> prop,{" "}
					<code>aria-pressed</code> toggles, an open menu trigger with{" "}
					<code>data-state="open"</code>) and is kept as it was: only outline and ghost fill to{" "}
					<code>control-bg-selected</code>, which shares its palette source with{" "}
					<code>control-bg-hovered</code>; primary, soft-primary and destructive have no selected
					look. Forced states use the rule-rewrite fixture; selected is the real prop.
				</p>
				{VARIANTS.map((variant) => (
					<div key={variant} className="bk-row">
						<div className="bk-row-head">
							<code>{variant}</code> · M
						</div>
						<div className="bk-cells">
							{PRESS_STATES.map((st) => (
								<Specimen
									key={st.id}
									theme={theme}
									surface={surface}
									s={{
										id: `press:${variant}:m:${st.id}`,
										label: st.label,
										size: SIZES[1],
										force: st.force,
										render: () => content(variant, "m", "icon left + text", st.props),
									}}
								/>
							))}
							<Specimen
								theme={theme}
								surface={surface}
								s={{
									id: `press:${variant}:m:icon-selected`,
									label: "icon-only selected",
									size: SIZES[1],
									expect: "icon",
									render: () => content(variant, "m", "icon only", { selected: true }),
								}}
							/>
						</div>
					</div>
				))}
				<h3>Persistent selection in the app today</h3>
				<div className="bk-cells">
					<figure className="bk-spec">
						<div className={`bk-stage ${surface}`}>
							<HeaderIconButton
								testid="bk-hib-off"
								label="Hide whitespace changes"
								icon={RiEyeLine}
								onClick={() => {}}
							/>
							<HeaderIconButton
								testid="bk-hib-on"
								label="Hide whitespace changes"
								icon={RiEyeLine}
								active
								onClick={() => {}}
							/>
						</div>
						<figcaption className="bk-cap">
							<div className="bk-cap-label">
								HeaderIconButton toggle — off / active (aria-pressed)
							</div>
							<div className="bk-note">
								apps/web/src/panels/HeaderIconButton.tsx → IconButton ghost m selected
							</div>
						</figcaption>
					</figure>
					<figure className="bk-spec">
						<div className={`bk-stage ${surface}`}>
							<IconButton icon={RiMore2Line} label="Actions" />
							<IconButton icon={RiMore2Line} label="Actions" data-state="open" />
						</div>
						<figcaption className="bk-cap">
							<div className="bk-cap-label">Menu trigger — closed / open (data-state="open")</div>
							<div className="bk-note">
								workspace kebab, chat history, Search open tabs, bottom alignment
							</div>
						</figcaption>
					</figure>
					<figure className="bk-spec">
						<div className={`bk-stage ${surface}`}>
							<Button variant="outline" size="m" iconLeft={RiCheckLine}>
								Viewed
							</Button>
							<Button variant="outline" size="m" iconLeft={RiCheckLine} selected aria-pressed>
								Viewed
							</Button>
						</div>
						<figcaption className="bk-cap">
							<div className="bk-cap-label">
								Outline toggle — off / on (Changes review Viewed, hunk Keep)
							</div>
							<div className="bk-note">
								apps/web/src/panels/ChangesReviewPane.tsx · resource-renderers hunk actions
							</div>
						</figcaption>
					</figure>
				</div>
				<h3>Panel tool rails — ghost M icon-button skin</h3>
				<p className="bk-note">
					<code>AuxiliaryRailToolButton</code>, <code>AuxiliaryRailButton</code> and a{" "}
					<code>WorkbenchTab</code> placed in a rail (apps/web/src/shell/layout) keep their own
					element (roving toolbar, drag and drop, adornments) but wear{" "}
					<code>buttonVariants(ghost, m, icon)</code>: 24px square, 16px icon, shared hover (pressed
					looks the same) and offset focus outline. The open panel is <code>data-selected</code>{" "}
					(the shared selected fill, unchanged) plus a Fill icon and <code>aria-pressed</code>; the
					former accent edge bar is removed. Below: the real components with mock entries.
				</p>
				<div className="bk-cells">
					<figure className="bk-spec">
						<div className={`bk-stage ${surface} bk-rail-stage`}>
							<AuxiliaryRail
								region="left"
								entries={RAIL_ENTRIES}
								renderEntry={(entry, control) =>
									entry.kind === "tool" ? (
										<AuxiliaryRailToolButton
											entry={entry}
											controls="bk-rail-panel"
											control={control}
											onActivate={() => {}}
										/>
									) : null
								}
							/>
						</div>
						<figcaption className="bk-cap">
							<div className="bk-cap-label">
								left rail — Projects open (selected + expanded), Files / Changes / Review closed
							</div>
							<div className="bk-note">hover or Tab the entries for real states</div>
						</figcaption>
					</figure>
				</div>
			</section>

			<section id="interactive" className="bk-section">
				<h2>Interactive</h2>
				<p className="bk-note">
					Hover, press and Tab through these real buttons. Clicks: {clicks}.
				</p>
				{VARIANTS.map((variant) => (
					<div key={variant} className="bk-inline">
						<code className="bk-inline-name">{variant}</code>
						{SIZES.map((g) => (
							<span key={g.id} className={`bk-inline-stage ${surface}`}>
								{CONFIGS.map((config) => (
									<span key={config}>
										{content(variant, g.id, config, { onClick: () => setClicks((c) => c + 1) })}
									</span>
								))}
							</span>
						))}
					</div>
				))}
				<div className="bk-inline">
					<code className="bk-inline-name">loading</code>
					<span className={`bk-inline-stage ${surface}`}>
						<Button
							variant="primary"
							size="m"
							iconLeft={RiAddLine}
							loading={busy}
							onClick={() => {
								setBusy(true);
								setClicks((c) => c + 1);
								setTimeout(() => setBusy(false), 1500);
							}}
						>
							Click me — busy 1.5 s
						</Button>
					</span>
					<span className="bk-note">extra clicks while busy are ignored (clicks counter)</span>
				</div>
			</section>

			<section id="exemplars" className="bk-section">
				<h2>Exemplars — before (bbb0e307) and after</h2>
				<Exemplars theme={theme} surface={surface} />
			</section>

			<section id="api" className="bk-section">
				<h2>API</h2>
				<pre className="bk-code">{`import { Button, IconButton } from "@thinkrail/ui/button";

<Button variant="primary" | "soft-primary" | "outline" | "ghost" | "destructive"   // default primary
        size="s" | "m" | "l"                                                      // default l
        iconLeft={RiAddLine} iconRight={RiArrowDownSLine}                         // components, sized by the button
        loading selected disabled>
  Label
</Button>

<IconButton icon={RiSettings3Line} label="Settings"   // label = aria-label + shared tooltip
            variant="ghost" size="m" selected loading wrapTrigger tooltipSide="bottom" />`}</pre>
			</section>
		</div>
	);
}

/** The production toast markup (apps/web/src/panels/Toaster.tsx) with mock content, in an inline viewport. */
function LiveToast() {
	return (
		<div className="bk-toast-frame">
			<ToastProvider>
				<Toast open duration={Number.POSITIVE_INFINITY} variant="info" data-testid="bk-live-toast">
					<div className="flex items-start gap-8">
						<div className="flex min-w-0 flex-1 flex-col gap-4">
							<ToastTitle>Agent finished</ToastTitle>
							<ToastDescription>
								Mock toast — Tab to the dismiss button for real keyboard focus.
							</ToastDescription>
						</div>
						<ToastClose />
					</div>
					<div className="mt-12 flex justify-end">
						<ToastAction altText="Open chat" asChild>
							<Button variant="outline" size="m">
								Open chat
							</Button>
						</ToastAction>
					</div>
				</Toast>
				<ToastViewport />
			</ToastProvider>
		</div>
	);
}

const BEFORE = import.meta.glob("../data/buttons-before/*.jpg", {
	eager: true,
	query: "?inline",
	import: "default",
}) as Record<string, string>;
const before = (name: string, theme: string) =>
	BEFORE[`../data/buttons-before/${name}--${theme}.jpg`];

const EXEMPLARS: {
	title: string;
	source: string;
	images: [string, string][];
	after: () => ReactNode;
}[] = [
	{
		title: "Primary — shared primary button (Settings › Providers › Connect)",
		source: "packages/ui/button.tsx variant=default size=sm → variant=primary size=m",
		images: [
			["old-primary", "rest / hover / focus-visible (old specimen)"],
			["C-focus-primary-button", "real keyboard focus in the running app"],
		],
		after: () => (
			<>
				<Button variant="primary" size="m">
					Connect
				</Button>
				<Button variant="primary" size="m" className="dsa-force-hover">
					Connect
				</Button>
				<Button variant="primary" size="m" className="dsa-force-focus-visible">
					Connect
				</Button>
			</>
		),
	},
	{
		title: "Soft-primary — Settings › Providers Sign in / Sign out",
		source: "apps/web/src/panels/ProvidersSettings.tsx Button soft sm → soft-primary m",
		images: [
			["old-soft", "rest / hover / focus-visible (old specimen)"],
			["C-focus-soft-button", "real keyboard focus in the running app"],
		],
		after: () => (
			<>
				<Button variant="soft-primary" size="m" iconLeft={RiLoginBoxLine}>
					Sign in
				</Button>
				<Button
					variant="soft-primary"
					size="m"
					iconLeft={RiLogoutBoxLine}
					className="dsa-force-hover"
				>
					Sign out
				</Button>
				<Button
					variant="soft-primary"
					size="m"
					iconLeft={RiLoginBoxLine}
					className="dsa-force-focus-visible"
				>
					Sign in
				</Button>
			</>
		),
	},
	{
		title: "Outline — Settings › Providers API key",
		source: "apps/web/src/panels/ProvidersSettings.tsx Button outline sm → outline m",
		images: [
			["old-outline", "rest / hover / focus-visible (old specimen)"],
			["C-focus-outline-button", "real keyboard focus in the running app"],
		],
		after: () => (
			<>
				<Button variant="outline" size="m" iconLeft={RiKey2Line}>
					API key
				</Button>
				<Button variant="outline" size="m" iconLeft={RiKey2Line} className="dsa-force-hover">
					API key
				</Button>
				<Button
					variant="outline"
					size="m"
					iconLeft={RiKey2Line}
					className="dsa-force-focus-visible"
				>
					API key
				</Button>
			</>
		),
	},
	{
		title: "Ghost — notifications secondary action (toast dismiss / old ghost)",
		source: "packages/ui/toast.tsx ToastClose → IconButton ghost m; ghost text button m",
		images: [["old-ghost", "rest / hover / focus-visible (old specimen)"]],
		after: () => (
			<>
				<Button variant="ghost" size="m">
					Not now
				</Button>
				<Button variant="ghost" size="m" className="dsa-force-hover">
					Not now
				</Button>
				<Button variant="ghost" size="m" className="dsa-force-focus-visible">
					Not now
				</Button>
				<IconButton variant="ghost" size="m" icon={RiCloseLine} label="Dismiss" />
				<IconButton
					variant="ghost"
					size="m"
					icon={RiCloseLine}
					label="Dismiss"
					className="dsa-force-hover"
				/>
				<IconButton
					variant="ghost"
					size="m"
					icon={RiCloseLine}
					label="Dismiss"
					className="dsa-force-focus-visible"
				/>
				<LiveToast />
			</>
		),
	},
	{
		title: "Destructive — confirm popovers / dialogs",
		source: "apps/web/src/panels/ConfirmPopover.tsx / ConfirmDialog.tsx Button destructive",
		images: [["old-destructive", "rest / hover (old: opacity 0.9) / focus-visible (old specimen)"]],
		after: () => (
			<>
				<Button variant="destructive" size="m">
					Remove
				</Button>
				<Button variant="destructive" size="m" className="dsa-force-hover">
					Remove
				</Button>
				<Button variant="destructive" size="m" className="dsa-force-focus-visible">
					Remove
				</Button>
			</>
		),
	},
];

function Exemplars({ theme, surface }: { theme: string; surface: string }) {
	return (
		<div className="bk-exemplars">
			{EXEMPLARS.map((x) => (
				<div key={x.title} className="bk-exemplar">
					<div className="bk-exemplar-title">{x.title}</div>
					<div className="bk-note">{x.source}</div>
					<div className="bk-ba">
						<div>
							<div className="bk-ba-label">before — captured at bbb0e307</div>
							{x.images.map(([name, caption]) => {
								const url = before(name, theme);
								return (
									<figure key={name} className="bk-before">
										{url ? (
											<img src={url} alt={caption} />
										) : (
											<div className="bk-note">not captured in this theme</div>
										)}
										<figcaption>{caption}</figcaption>
									</figure>
								);
							})}
						</div>
						<div>
							<div className="bk-ba-label">
								after — live component (rest / hover / focus-visible)
							</div>
							<div className={`bk-after ${surface}`}>{x.after()}</div>
						</div>
					</div>
				</div>
			))}
		</div>
	);
}
