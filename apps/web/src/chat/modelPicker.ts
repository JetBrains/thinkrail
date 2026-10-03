import type { ProviderAuthKind, ThinkingLevel, WireModel } from "@thinkrail/contracts";

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

const AUTH_KIND_LABEL: Record<ProviderAuthKind, string> = {
	oauth: "subscription",
	"api-key": "API key",
	env: "environment key",
	central: "JetBrains AI",
	other: "configured",
};

/** `$in / $out` list prices per Mtok when the provider bills per token (or the kind is unknown). */
export function costLabel(model: WireModel): string | null {
	if (!model.cost) return null;
	if (model.auth && !billsPerToken(model.auth.kind)) return null;
	return `${formatPrice(model.cost.input)} / ${formatPrice(model.cost.output)}`;
}

/** The short word that sits beside the connection glyph in a row: what this model draws on. */
export function kindLabel(model: WireModel): string | null {
	const auth = model.auth;
	if (!auth) return null;
	switch (auth.kind) {
		case "oauth":
			return auth.detail ?? "plan";
		case "central":
			return "quota";
		case "env":
			return auth.detail ?? "env";
		case "api-key":
			return auth.detail ?? "API key";
		default:
			return null;
	}
}

/** The full sentence for tooltips and group headings: kind word plus pi's detail. */
export function describeAuth(model: WireModel): string | null {
	if (!model.auth) return null;
	const label = AUTH_KIND_LABEL[model.auth.kind];
	return model.auth.detail ? `${label} · ${model.auth.detail}` : label;
}

export const LEVEL_HINT: Partial<Record<ThinkingLevel, string>> = {
	off: "No reasoning — fastest, cheapest",
	minimal: "Briefest reasoning",
	low: "Light reasoning — fastest",
	medium: "Balanced reasoning",
	high: "Deep reasoning",
	xhigh: "Extra-deep — slower",
	max: "Maximum — uses your limits faster",
};

export const EFFORT_BARS = 4;

/** How many of the effort bars light up: none for `off`, otherwise the level's rank among the model's reasoning levels scaled to the bar count (never zero). */
export function litBars(level: ThinkingLevel, levels: readonly ThinkingLevel[]): number {
	const reasoning: readonly ThinkingLevel[] = levels.filter((candidate) => candidate !== "off");
	const rank = reasoning.indexOf(level);
	if (rank < 0) return 0;
	return Math.max(1, Math.round(((rank + 1) / reasoning.length) * EFFORT_BARS));
}

export interface ProviderGroup {
	provider: string;
	models: WireModel[];
	auth: string | null;
}

export function groupByProvider(models: readonly WireModel[]): ProviderGroup[] {
	const groups = new Map<string, WireModel[]>();
	for (const model of models) {
		const list = groups.get(model.provider);
		if (list) list.push(model);
		else groups.set(model.provider, [model]);
	}
	return [...groups].map(([provider, list]) => ({
		provider,
		models: list,
		auth: list.map(describeAuth).find((auth) => auth !== null) ?? null,
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
