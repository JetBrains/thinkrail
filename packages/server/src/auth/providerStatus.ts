import type {
	JbcentralInstall,
	ProviderAuthKind,
	ProviderStatus,
	ProviderStatusReport,
} from "@thinkrail/contracts";
import {
	isJbcentralInstalled,
	isJbcentralProxyUrl,
	jbcentralInstall,
} from "@thinkrail/shared/jbcentral";
import { getPiRuntime } from "../agent";

/**
 * Providers whose api-key setup isn't a single string (AWS creds, GCP service account, Azure resource +
 * key) — `provider.setApiKey` posts one string, so the strip offers no inline key field for them. Since
 * pi 0.80.8 the provider-owned truth is public (`Provider.auth.apiKey.login` drives an interactive,
 * possibly multi-prompt flow — and `amazon-bedrock` now accepts a single API key that way); these sets
 * stay until the strip adopts that flow (tracked as a follow-up issue) because the inline field can only
 * answer a single secret prompt.
 */
const MULTI_FIELD_PROVIDERS = new Set([
	"amazon-bedrock",
	"google-vertex",
	"azure-openai-responses",
]);

/** OAuth-only providers (`Provider.auth` has no api-key login) — a raw api key is never the right entry. */
const OAUTH_ONLY_PROVIDERS = new Set(["github-copilot"]);

/**
 * The narrow slice of the pi runtime the report reads — extracted so `buildProviderReport` stays a pure
 * function unit-testable with fixture data (no auth/network/disk).
 */
export interface ProviderStatusSources {
	/** provider id → its models' *effective* baseUrls (the registry's post-merge state). */
	modelProviders: Map<string, string[]>;
	/** Providers with ≥1 model whose auth resolves (the registry's `getAvailable()` truth). */
	availableProviders: Set<string>;
	/** Providers holding credentials in auth.json (`listCredentials()`), even model-less ones. */
	credentialProviders: string[];
	/**
	 * OAuth-capable providers (`Provider.auth.oauth` present) — `id` is the login handle passed to
	 * `provider.loginStart` (note: `openai-codex`/`github-copilot` ≠ their model-catalog provider ids), and
	 * `name` is the OAuth method's own label, more specific than the provider's for oauth-only rows.
	 */
	oauthProviders: { id: string; name: string }[];
	/** auth.json credential kind, when stored there. */
	credentialType: (id: string) => "oauth" | "api_key" | undefined;
	/** pi's provider auth status — `source`/`label` only; `configured` here is auth.json-centric. */
	providerAuth: (id: string) => { source?: string; label?: string };
	/** Whether pi's provider supports interactive api-key setup (`Provider.auth.apiKey.login` present) —
	 * OAuth-only providers (e.g. `openai-codex`) report `false` even though they have model rows. */
	apiKeyLogin: (id: string) => boolean;
	displayName: (id: string) => string;
	/** Any auth form at all (stored / runtime / env) — the fallback truth for model-less providers. */
	hasAuth: (id: string) => boolean;
	/** Whether the `central` CLI is on PATH — surfaced so the JetBrains AI card knows its state. */
	jbcentralInstalled: boolean;
	/** The host's per-OS install command for the JetBrains Central CLI — carried to the card so it renders
	 * the right command (for the *host's* OS) when the CLI isn't installed. */
	jbcentralInstall: JbcentralInstall;
}

/** Map pi's auth source + credential kind onto the wire's `ProviderAuthKind`. */
function resolveKind(
	viaJbcentral: boolean,
	credentialType: "oauth" | "api_key" | undefined,
	source: string | undefined,
): ProviderAuthKind {
	if (viaJbcentral) return "central";
	if (credentialType === "oauth") return "oauth";
	if (credentialType === "api_key") return "api-key";
	switch (source) {
		case "environment":
			return "env";
		case "models_json_key":
		case "models_json_command":
		case "runtime":
			return "api-key";
		default:
			return "other";
	}
}

/** A human hint for the auth source (env var name, models.json) — never a credential value. */
function resolveDetail(
	kind: ProviderAuthKind,
	source?: string,
	label?: string,
): string | undefined {
	if (kind === "central") return undefined; // the kind's label says it all
	if (label) return label;
	if (source === "models_json_key") return "models.json";
	if (source === "models_json_command") return "models.json (command)";
	return undefined;
}

/** Pure assembly: configured providers first, alphabetical within each group. */
export function buildProviderReport(sources: ProviderStatusSources): ProviderStatusReport {
	const oauthIds = new Set(sources.oauthProviders.map((p) => p.id));
	const oauthName = new Map(sources.oauthProviders.map((p) => [p.id, p.name]));
	// Only providers with a stored auth.json credential are removable in-app; env / central (models.json) /
	// models.json-keyed auth can't be unset by the runtime's `logout`, so Sign-out is hidden for them.
	const removable = new Set(sources.credentialProviders);
	// Every loginable thing is a row: model providers + stored credentials + OAuth providers (so the
	// oauth-only ids `openai-codex`/`github-copilot` show a Sign-in row even with no models registered).
	const ids = new Set<string>([
		...sources.modelProviders.keys(),
		...sources.credentialProviders,
		...oauthIds,
	]);
	let jbcentralWired = false;

	const providers: ProviderStatus[] = [...ids].map((id) => {
		const baseUrls = sources.modelProviders.get(id) ?? [];
		const viaJbcentral = baseUrls.some((url) => isJbcentralProxyUrl(url));
		if (viaJbcentral) jbcentralWired = true;
		// Prefer the registry's display name; fall back to the OAuth provider's label for ids the registry
		// doesn't know (an oauth-only provider with no models yet resolves to its own id otherwise).
		const registryName = sources.displayName(id);
		const name = registryName === id ? (oauthName.get(id) ?? registryName) : registryName;
		const canOAuth = oauthIds.has(id);
		// The inline key field: the provider must have models, pi must support api-key login for it, and it
		// must not be excluded as multi-field / oauth-only (see the sets above — the field posts ONE string).
		const canApiKey =
			sources.modelProviders.has(id) &&
			sources.apiKeyLogin(id) &&
			!MULTI_FIELD_PROVIDERS.has(id) &&
			!OAUTH_ONLY_PROVIDERS.has(id);
		const login = {
			...(canOAuth ? { canOAuth: true } : {}),
			...(canApiKey ? { canApiKey: true } : {}),
			...(removable.has(id) ? { canLogout: true } : {}),
		};
		// A provider with models is configured iff the registry can resolve auth for it; a model-less
		// credential entry falls back to `hasAuth` (it holds a key, so report it rather than hide it).
		const configured =
			sources.availableProviders.has(id) || (baseUrls.length === 0 && sources.hasAuth(id));
		if (!configured) return { id, name, configured: false, ...login };
		const { source, label } = sources.providerAuth(id);
		const kind = resolveKind(viaJbcentral, sources.credentialType(id), source);
		const detail = resolveDetail(kind, source, label);
		return {
			id,
			name,
			configured: true,
			kind,
			...(detail !== undefined ? { detail } : {}),
			...login,
		};
	});

	providers.sort((a, b) => {
		if (a.configured !== b.configured) return a.configured ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
	return {
		providers,
		jbcentralWired,
		jbcentralInstalled: sources.jbcentralInstalled,
		jbcentralInstall: sources.jbcentralInstall,
	};
}

/**
 * The `provider.status` read. **Revalidates on every call** — `runtime.reloadConfig()` (reload
 * models.json, recompose providers, refresh availability; auth.json is read live by pi's credential
 * store) — so a `pi` `/login` (or a terminal `central` re-wire) shows up on the next read without
 * restarting the host. (Accepted micro-risk: refreshing the shared runtime concurrent with a streaming
 * session — the same thing pi's TUI does on `/login`.)
 */
export async function getProviderStatus(): Promise<ProviderStatusReport> {
	const runtime = await getPiRuntime();
	await runtime.reloadConfig();

	const modelProviders = new Map<string, string[]>();
	for (const model of runtime.getModels()) {
		const urls = modelProviders.get(model.provider) ?? [];
		urls.push(model.baseUrl);
		modelProviders.set(model.provider, urls);
	}
	const available = await runtime.getAvailable();
	const credentials = await runtime.listCredentials();
	const credentialTypes = new Map(credentials.map((c) => [c.providerId, c.type]));

	return buildProviderReport({
		modelProviders,
		availableProviders: new Set(available.map((m) => m.provider)),
		credentialProviders: credentials.map((c) => c.providerId),
		oauthProviders: runtime
			.getProviders()
			.filter((p) => p.auth.oauth)
			.map((p) => ({ id: p.id, name: p.auth.oauth?.name ?? p.name })),
		credentialType: (id) => credentialTypes.get(id),
		providerAuth: (id) => runtime.getProviderAuthStatus(id),
		apiKeyLogin: (id) => Boolean(runtime.getProvider(id)?.auth.apiKey?.login),
		displayName: (id) => runtime.getProvider(id)?.name ?? id,
		hasAuth: (id) => runtime.getProviderAuthStatus(id).configured,
		jbcentralInstalled: isJbcentralInstalled(),
		jbcentralInstall: jbcentralInstall(process.platform),
	});
}
