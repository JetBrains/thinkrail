/**
 * One-shot LLM completions — the primitive behind the ad-hoc "assist" tasks (workspace naming, PR
 * drafting). It runs a **single** completion on a cheap, already-authenticated model: no
 * `AgentSession`, no tools, no extensions, nothing written to disk. Dispatch goes through the shared
 * `ModelRuntime.completeSimple()` — pi's canonical provider-agnostic request path (it also serves
 * providers that only implement `streamSimple`, e.g. extension-registered ones), which resolves the
 * model's auth itself (OAuth refresh included), so there is no separate auth-resolution step here.
 */
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { getPiRuntime } from "./piRuntime";

/** Which model a one-shot task reaches for. `cheap` = small/fast; `default` = first authenticated. */
export type ModelTier = "cheap" | "default";

export interface OneShotRequest {
	/** System prompt — the task instructions. */
	system?: string;
	/** The single user message. */
	prompt: string;
	/** Model tier (default `cheap`). */
	tier?: ModelTier;
	/** Hard cap on output tokens — keep tasks tiny (a name is ~a dozen tokens). Default 256. */
	maxTokens?: number;
	/** Sampling temperature (default 0.2 — these tasks want determinism, not creativity). */
	temperature?: number;
	/** Abort/timeout — always give one so a task never blocks its caller indefinitely. */
	signal?: AbortSignal;
}

export interface OneShotResult {
	/** The concatenated assistant text, trimmed. */
	text: string;
	/** The model that answered (display/telemetry only — pi owns the numbers). */
	model: { provider: string; id: string };
}

// Known small/fast models per provider, in priority order. Matched by id **prefix** against the
// authenticated set, so an entry only wins when its provider is actually logged in. Extend as providers
// ship cheaper tiers — the cost-based fallback below covers anything not listed here.
const CHEAP_MODELS: ReadonlyArray<readonly [provider: string, idPrefix: string]> = [
	["anthropic", "claude-haiku"],
	["anthropic", "claude-3-5-haiku"],
	["openai", "gpt-5-mini"],
	["openai", "gpt-4o-mini"],
	["openai", "gpt-4.1-mini"],
	["google", "gemini-2.5-flash"],
	["google", "gemini-flash"],
	["xai", "grok-code-fast"],
	["xai", "grok-3-mini"],
];

/**
 * The model a one-shot task should use. For `cheap`: the first {@link CHEAP_MODELS} entry whose provider
 * is authenticated, else the cheapest authenticated model by per-token cost (id as a stable tiebreak).
 * For `default`: the first authenticated model. `null` when nothing is authenticated — the caller
 * degrades gracefully rather than erroring.
 */
export async function pickModel(tier: ModelTier = "cheap"): Promise<Model<Api> | null> {
	const available = await (await getPiRuntime()).getAvailable();
	if (available.length === 0) return null;
	if (tier === "default") return available[0] ?? null;
	for (const [provider, prefix] of CHEAP_MODELS) {
		const hit = available.find((m) => m.provider === provider && m.id.startsWith(prefix));
		if (hit) return hit;
	}
	return (
		[...available].sort((a, b) => {
			const byCost = a.cost.input + a.cost.output - (b.cost.input + b.cost.output);
			return byCost !== 0 ? byCost : a.id.localeCompare(b.id);
		})[0] ?? null
	);
}

/**
 * Run a single completion on a picked model. Throws `"no-model"` when nothing is authenticated, or the
 * provider's error message when auth resolution / the request fails. Callers that must not fail (the
 * assist tasks) wrap this and fall back.
 */
export async function completeOnce(req: OneShotRequest): Promise<OneShotResult> {
	const runtime = await getPiRuntime();
	const model = await pickModel(req.tier);
	if (!model) throw new Error("no-model");

	const context: Context = {
		...(req.system ? { systemPrompt: req.system } : {}),
		messages: [{ role: "user", content: req.prompt, timestamp: Date.now() }],
	};
	const message = await runtime.completeSimple(model, context, {
		maxTokens: req.maxTokens ?? 256,
		temperature: req.temperature ?? 0.2,
		...(req.signal ? { signal: req.signal } : {}),
	});

	const text = message.content
		.filter((c) => c.type === "text")
		.map((c) => c.text)
		.join("")
		.trim();
	return { text, model: { provider: String(model.provider), id: model.id } };
}
