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
 * Providers whose api key isn't a single string (AWS creds, GCP service account, Azure resource + key) —
 * `provider.setApiKey` can't configure them, so the strip offers no inline key field. (`amazon-bedrock`
 * *is* in pi's api-key display map, so pi's own `isApiKeyLoginProvider` returns true for it, but the TUI
 * special-cases it with a multi-field dialog — we exclude it rather than mis-handle a single key.)
 */
const MULTI_FIELD_PROVIDERS = new Set([
	"amazon-bedrock",
	"google-vertex",
	"azure-openai-responses",
]);

/** OAuth-only providers (not in pi's api-key display map) — a raw api key is never the right entry for them. */
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
	/** Providers holding credentials in auth.json (`authStorage.list()`), even model-less ones. */
	credentialProviders: string[];
	/**
	 * Registered OAuth providers (`authStorage.getOAuthProviders()`) — `id` is the login handle passed to
	 * `provider.loginStart` (note: `openai-codex`/`github-copilot` ≠ their model-registry provider ids), and
	 * `name` is a more specific label than the registry's for oauth-only rows.
	 */
	oauthProviders: { id: string; name: string }[];
	/** auth.json credential kind, when stored there. */
	credentialType: (id: string) => "oauth" | "api_key" | undefined;
	/** pi's provider auth status — `source`/`label` only; `configured` here is auth.json-centric. */
	providerAuth: (id: string) => { source?: string; label?: string };
	displayName: (id: string) => string;
	/** Any auth form at all (stored / runtime / env) — the fallback truth for model-less providers. */
	hasAuth: (id: string) => boolean;
	/** Whether the `jbcentral` CLI is on PATH — surfaced so the JetBrains AI card knows its state. */
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
	if (viaJbcentral) return "jbcentral";
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
	if (kind === "jbcentral") return undefined; // the kind's label says it all
	if (label) return label;
	if (source === "models_json_key") return "models.json";
	if (source === "models_json_command") return "models.json (command)";
	return undefined;
}

/** Pure assembly: configured providers first, alphabetical within each group. */
export function buildProviderReport(sources: ProviderStatusSources): ProviderStatusReport {
	const oauthIds = new Set(sources.oauthProviders.map((p) => p.id));
	const oauthName = new Map(sources.oauthProviders.map((p) => [p.id, p.name]));
	// Only providers with a stored auth.json credential are removable in-app; env / jbcentral (models.json) /
	// models.json-keyed auth can't be unset by `authStorage.logout`, so Sign-out is hidden for them.
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
		const canApiKey =
			sources.modelProviders.has(id) &&
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
 * The `provider.status` read. **Revalidates on every call** — `authStorage.reload()` +
 * `modelRegistry.refresh()` (pi's own reload APIs) — so `pi` `/login` or `thinkrail jbcentral` run in a
 * terminal shows up on the next read without restarting the host. (Accepted micro-risk: refreshing the
 * shared registry concurrent with a streaming session — the same thing pi's TUI does on `/login`.)
 */
export function getProviderStatus(): ProviderStatusReport {
	const { authStorage, modelRegistry } = getPiRuntime();
	authStorage.reload();
	modelRegistry.refresh();

	const modelProviders = new Map<string, string[]>();
	for (const model of modelRegistry.getAll()) {
		const urls = modelProviders.get(model.provider) ?? [];
		urls.push(model.baseUrl);
		modelProviders.set(model.provider, urls);
	}

	return buildProviderReport({
		modelProviders,
		availableProviders: new Set(modelRegistry.getAvailable().map((m) => m.provider)),
		credentialProviders: authStorage.list(),
		oauthProviders: authStorage.getOAuthProviders().map((p) => ({ id: p.id, name: p.name })),
		credentialType: (id) => authStorage.get(id)?.type,
		providerAuth: (id) => modelRegistry.getProviderAuthStatus(id),
		displayName: (id) => modelRegistry.getProviderDisplayName(id),
		hasAuth: (id) => authStorage.hasAuth(id),
		jbcentralInstalled: isJbcentralInstalled(),
		jbcentralInstall: jbcentralInstall(process.platform),
	});
}
