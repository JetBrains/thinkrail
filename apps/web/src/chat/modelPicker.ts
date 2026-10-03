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

export function describeCost(model: WireModel): string | null {
	const kind = model.auth?.kind;
	if (kind === "oauth") return "plan";
	if (kind === "central") return "quota";
	if (!model.cost) return null;
	return `${formatPrice(model.cost.input)} / ${formatPrice(model.cost.output)}`;
}

export function describeAuth(model: WireModel): string | null {
	if (!model.auth) return null;
	const label = AUTH_KIND_LABEL[model.auth.kind];
	return model.auth.detail ? `${label} · ${model.auth.detail}` : label;
}

export const LEVEL_HINT: Partial<Record<ThinkingLevel, string>> = {
	off: "No reasoning — fastest, cheapest",
	minimal: "Briefest reasoning",
	low: "Light reasoning",
	medium: "Balanced reasoning",
	high: "Deep reasoning",
	xhigh: "Extra-deep reasoning — slower, costlier",
	max: "Maximum reasoning — slowest, costliest",
};

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

/** The query's trailing word, when it names a level the highlighted model supports (`opus high`). */
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
