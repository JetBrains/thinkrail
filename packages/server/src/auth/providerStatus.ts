import type {
	JbcentralInstall,
	JbcentralStatus,
	ProviderAuthKind,
	ProviderStatus,
	ProviderStatusReport,
} from "@thinkrail/contracts";
import { jbcentralInstall } from "@thinkrail/shared/jbcentral";
import { settledAvailableModels, usePiRuntime } from "../agent";
import { getJbcentralStatus } from "./jbcentral";

/**
 * The narrow slice of the pi runtime the report reads — extracted so `buildProviderReport` stays a pure
 * function unit-testable with fixture data (no auth/network/disk).
 */
export interface ProviderStatusSources {
	/** Provider ids with at least one registered model. Raw models and endpoints never leave the host. */
	modelProviderIds: Set<string>;
	/** Providers with ≥1 model in the registry's last settled availability snapshot. */
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
	/** Closed Central version/configuration/action state. */
	jbcentral: JbcentralStatus;
	/** The host's per-OS official install plan. */
	jbcentralInstall: JbcentralInstall;
}

/** Map pi's auth source + credential kind onto the wire's `ProviderAuthKind`. */
function resolveKind(
	credentialType: "oauth" | "api_key" | undefined,
	source: string | undefined,
): ProviderAuthKind {
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
function resolveDetail(source?: string, label?: string): string | undefined {
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
		...sources.modelProviderIds,
		...sources.credentialProviders,
		...oauthIds,
	]);
	const providers: ProviderStatus[] = [...ids].map((id) => {
		// Prefer the registry's display name; fall back to the OAuth provider's label for ids the registry
		// doesn't know (an oauth-only provider with no models yet resolves to its own id otherwise).
		const registryName = sources.displayName(id);
		const name = registryName === id ? (oauthName.get(id) ?? registryName) : registryName;
		const canOAuth = oauthIds.has(id);
		// Interactive API-key login (via the same login channel as OAuth) — pi's provider-owned truth,
		// nothing else: `Provider.auth.apiKey.login` is absent exactly for ambient-only providers
		// (openai-codex, env-driven customs). Multi-prompt providers (azure/vertex) work — the dialog
		// carries the whole interaction, so no hand-maintained exclusion sets exist anymore (issue #97).
		const canApiKey = sources.apiKeyLogin(id);
		const login = {
			...(canOAuth ? { canOAuth: true } : {}),
			...(canApiKey ? { canApiKey: true } : {}),
			...(removable.has(id) ? { canLogout: true } : {}),
		};
		// A provider with models is configured iff the registry can resolve auth for it; a model-less
		// credential entry falls back to `hasAuth` (it holds a key, so report it rather than hide it).
		const configured =
			sources.availableProviders.has(id) ||
			(!sources.modelProviderIds.has(id) && sources.hasAuth(id));
		if (!configured) return { id, name, configured: false, ...login };
		const { source, label } = sources.providerAuth(id);
		const kind = resolveKind(sources.credentialType(id), source);
		const detail = resolveDetail(source, label);
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
		jbcentral: sources.jbcentral,
		jbcentralInstall: sources.jbcentralInstall,
	};
}

/**
 * The `provider.status` read. **Revalidates on every call** — `runtime.refresh()` (pi 0.82 folded the
 * old `reloadConfig()` into it) reloads models.json and recomposes only the pre-opaque provider allowlist
 * (it does NOT touch auth.json itself), and its availability refresh re-runs auth checks only for those
 * providers against pi's credential store, which reads auth.json fresh (under a lock) on every access —
 * so a `pi` `/login` shows up on the next read without restarting the host. The runtime's ambient network
 * default remains OFF (see `piRuntime`). (Accepted micro-risk: refreshing the shared runtime concurrent
 * with a streaming session — the same thing pi's TUI does on `/login`.)
 */
export async function getProviderStatus(): Promise<ProviderStatusReport> {
	const jbcentral = await getJbcentralStatus();
	const install = jbcentralInstall(process.platform);
	return usePiRuntime(async (runtime, generation) => {
		const providerStatusIds = [...generation.providerStatusIds];
		try {
			await runtime.refresh({ providers: providerStatusIds });
		} catch {
			throw new Error("Provider status refresh failed");
		}

		const providerStatusIdSet = new Set(providerStatusIds);
		const visibleProviders = providerStatusIds.flatMap((id) => {
			const provider = runtime.getProvider(id);
			return provider ? [provider] : [];
		});
		const available = settledAvailableModels(runtime).filter((model) =>
			providerStatusIdSet.has(model.provider),
		);
		const credentials = await runtime.listCredentials();
		const visibleCredentials = credentials.filter((credential) =>
			providerStatusIdSet.has(credential.providerId),
		);
		const credentialTypes = new Map(
			visibleCredentials.map((credential) => [credential.providerId, credential.type]),
		);

		return buildProviderReport({
			modelProviderIds: new Set(
				providerStatusIds.filter((providerId) => runtime.getModels(providerId).length > 0),
			),
			availableProviders: new Set(available.map((model) => model.provider)),
			credentialProviders: visibleCredentials.map((credential) => credential.providerId),
			oauthProviders: visibleProviders
				.filter((provider) => provider.auth.oauth)
				.map((provider) => ({
					id: provider.id,
					name: provider.auth.oauth?.name ?? provider.name,
				})),
			credentialType: (id) => credentialTypes.get(id),
			providerAuth: (id) => runtime.getProviderAuthStatus(id),
			apiKeyLogin: (id) => Boolean(runtime.getProvider(id)?.auth.apiKey?.login),
			displayName: (id) => runtime.getProvider(id)?.name ?? id,
			hasAuth: (id) => runtime.getProviderAuthStatus(id).configured,
			jbcentral,
			jbcentralInstall: install,
		});
	});
}
