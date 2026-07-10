// Provider catalog policy: which OAuth flows are featured tiles, which providers are OAuth-only
// (excluded from the API-key form), and the conventional env-var hints for the majors.

/** Featured OAuth tiles, in gate order (the JetBrains AI tile is separate — it's the jbcentral flow). */
export const FEATURED_OAUTH_IDS = ["anthropic", "openai-codex", "github-copilot"] as const;

/** Providers that cannot take a pasted API key (subscription OAuth only) — hidden from the key form. */
export const OAUTH_ONLY_PROVIDER_IDS = new Set(["openai-codex", "github-copilot"]);

/**
 * Conventional env vars per provider (a UI hint only — pi resolves env keys itself). Curated from
 * pi's providers table; providers not listed simply show no hint.
 */
export const PROVIDER_ENV_VARS: Record<string, string> = {
	anthropic: "ANTHROPIC_API_KEY",
	openai: "OPENAI_API_KEY",
	google: "GEMINI_API_KEY",
	groq: "GROQ_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	mistral: "MISTRAL_API_KEY",
	xai: "XAI_API_KEY",
	deepseek: "DEEPSEEK_API_KEY",
	cerebras: "CEREBRAS_API_KEY",
	fireworks: "FIREWORKS_API_KEY",
	together: "TOGETHER_API_KEY",
	huggingface: "HF_TOKEN",
	nvidia: "NVIDIA_API_KEY",
	zai: "ZAI_API_KEY",
	opencode: "OPENCODE_API_KEY",
	"vercel-ai-gateway": "AI_GATEWAY_API_KEY",
	"kimi-coding": "KIMI_API_KEY",
	minimax: "MINIMAX_API_KEY",
};
