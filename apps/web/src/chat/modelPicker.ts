import type { ProviderAuthKind, ThinkingLevel, WireModel } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";

export function formatContext(tokens: number): string {
	if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`.replace(".0", "");
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
	return String(tokens);
}

export function formatPrice(perMillion: number): string {
	const rounded = perMillion >= 10 ? Math.round(perMillion) : Math.round(perMillion * 100) / 100;
	return `$${rounded}`;
}

/** Whether the provider bills per token — the only case a list price is what the user pays. */
export function billsPerToken(kind: ProviderAuthKind | undefined): boolean {
	return kind === "api-key" || kind === "env";
}

/** The one vocabulary for how a provider is connected, shared with Settings → Providers. */
export const AUTH_KIND_LABEL = {
	oauth: "chat.modelPicker.authKind.oauth",
	"api-key": "chat.modelPicker.authKind.apiKey",
	env: "chat.modelPicker.authKind.env",
	central: "chat.modelPicker.authKind.central",
	other: "chat.modelPicker.authKind.other",
} satisfies Record<ProviderAuthKind, MessageKey>;

/** The tag models routed through JetBrains AI (the Central proxy) wear where other kinds show a glyph. */
export const CENTRAL_KIND_TAG = "JCP";

/** `$in / $out` list prices per Mtok when the provider bills per token (or the kind is unknown). */
export function costLabel(model: WireModel): string | null {
	if (!model.cost) return null;
	if (model.auth && !billsPerToken(model.auth.kind)) return null;
	return `${formatPrice(model.cost.input)} / ${formatPrice(model.cost.output)}`;
}

/** The short word that sits beside the connection glyph in a row: what this model draws on. */
export function kindLabel(t: Translator, model: WireModel): string | null {
	const auth = model.auth;
	if (!auth) return null;
	switch (auth.kind) {
		case "oauth":
			return auth.detail ?? t("chat.modelPicker.kind.plan");
		case "central":
			return t("chat.modelPicker.kind.quota");
		case "env":
			return auth.detail ?? "env";
		case "api-key":
			return auth.detail ?? t("chat.modelPicker.kind.apiKey");
		default:
			return null;
	}
}

/** The full sentence for tooltips and group headings: kind word plus pi's detail. */
export function describeAuth(t: Translator, model: WireModel): string | null {
	if (!model.auth) return null;
	const label = t(AUTH_KIND_LABEL[model.auth.kind]);
	return model.auth.detail ? `${label} · ${model.auth.detail}` : label;
}

export const LEVEL_HINT = {
	off: "chat.modelPicker.levelHint.off",
	minimal: "chat.modelPicker.levelHint.minimal",
	low: "chat.modelPicker.levelHint.low",
	medium: "chat.modelPicker.levelHint.medium",
	high: "chat.modelPicker.levelHint.high",
	xhigh: "chat.modelPicker.levelHint.xhigh",
	max: "chat.modelPicker.levelHint.max",
} satisfies Record<ThinkingLevel, MessageKey>;

export const LEVEL_LABEL = {
	off: "chat.modelPicker.level.off",
	minimal: "chat.modelPicker.level.minimal",
	low: "chat.modelPicker.level.low",
	medium: "chat.modelPicker.level.medium",
	high: "chat.modelPicker.level.high",
	xhigh: "chat.modelPicker.level.xhigh",
	max: "chat.modelPicker.level.max",
} satisfies Record<ThinkingLevel, MessageKey>;

/** Levels whose cost deserves a warning beside the hint (what Codex and Claude.ai flag). */
export const COSTLY_LEVELS: ReadonlySet<ThinkingLevel> = new Set<ThinkingLevel>(["xhigh", "max"]);

export type LevelTone = "cool" | "accent" | "hot";

/** The colour temperature a level reads at: cool for the no/low-reasoning end, hot for the costly tiers. */
export function levelTone(level: ThinkingLevel): LevelTone {
	if (COSTLY_LEVELS.has(level)) return "hot";
	return level === "off" || level === "minimal" || level === "low" ? "cool" : "accent";
}

/** Where `level` sits on the model's own scale, 0 → 100; the slider handle's position. */
export function levelPosition(level: ThinkingLevel, levels: readonly ThinkingLevel[]): number {
	const index = levels.indexOf(level);
	if (index < 0 || levels.length < 2) return 0;
	return (index / (levels.length - 1)) * 100;
}

/** The effort bars, shortest first; their count is the scale `litBars` maps a level onto. */
export const EFFORT_BAR_HEIGHTS = ["h-4", "h-6", "h-8", "h-12"] as const;

/** How many effort bars light up: none for `off`, otherwise the level's rank among the model's reasoning levels scaled onto the bars (never zero). */
export function litBars(level: ThinkingLevel, levels: readonly ThinkingLevel[]): number {
	const reasoning: readonly ThinkingLevel[] = levels.filter((candidate) => candidate !== "off");
	const rank = reasoning.indexOf(level);
	if (rank < 0) return 0;
	return Math.max(1, Math.round(((rank + 1) / reasoning.length) * EFFORT_BAR_HEIGHTS.length));
}

export interface ProviderGroup {
	provider: string;
	models: WireModel[];
	auth: string | null;
}

const VERSION = /(?<![\d.])\d{1,3}(?:\.\d{1,3})*(?![\d.])/;

function nameVersion(name: string): number[] | null {
	const match = name.replace(/\([^)]*\)/g, "").match(VERSION);
	return match ? match[0].split(".").map(Number) : null;
}

function compareVersions(a: readonly number[], b: readonly number[]): number {
	for (let index = 0; index < Math.max(a.length, b.length); index++) {
		const delta = (b[index] ?? 0) - (a[index] ?? 0);
		if (delta !== 0) return delta;
	}
	return 0;
}

export function newestFirst(models: readonly WireModel[]): WireModel[] {
	return [...models].sort((a, b) => {
		const va = nameVersion(a.name);
		const vb = nameVersion(b.name);
		if (va && vb) return compareVersions(va, vb);
		return va ? -1 : vb ? 1 : 0;
	});
}

export function groupByProvider(t: Translator, models: readonly WireModel[]): ProviderGroup[] {
	const groups = new Map<string, WireModel[]>();
	for (const model of models) {
		const list = groups.get(model.provider);
		if (list) list.push(model);
		else groups.set(model.provider, [model]);
	}
	return [...groups].map(([provider, list]) => ({
		provider,
		models: newestFirst(list),
		auth: list.map((model) => describeAuth(t, model)).find((auth) => auth !== null) ?? null,
	}));
}

/** The query's trailing word, when it names a level the given model supports (`opus high`). */
export function trailingLevel(query: string, model: WireModel | null): ThinkingLevel | null {
	if (!model) return null;
	const tokens = query.trim().toLowerCase().split(/\s+/);
	const last = tokens[tokens.length - 1];
	if (!last || tokens.length < 2) return null;
	return model.thinkingLevels.find((level) => level === last) ?? null;
}

export function modelKey(model: Pick<WireModel, "provider" | "id">): string {
	return `${model.provider}:${model.id}`;
}
