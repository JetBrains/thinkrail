import type { ProviderAuthKind, ProviderStatus, ProviderStatusReport } from "@thinkrail/contracts";
import { isJbcentralProxyUrl } from "@thinkrail/shared/jbcentral";
import { getPiRuntime } from "./piRuntime";

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
	/** auth.json credential kind, when stored there. */
	credentialType: (id: string) => "oauth" | "api_key" | undefined;
	/** pi's provider auth status — `source`/`label` only; `configured` here is auth.json-centric. */
	providerAuth: (id: string) => { source?: string; label?: string };
	displayName: (id: string) => string;
	/** Any auth form at all (stored / runtime / env) — the fallback truth for model-less providers. */
	hasAuth: (id: string) => boolean;
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
	const ids = new Set<string>([...sources.modelProviders.keys(), ...sources.credentialProviders]);
	let jbcentralWired = false;

	const providers: ProviderStatus[] = [...ids].map((id) => {
		const baseUrls = sources.modelProviders.get(id) ?? [];
		const viaJbcentral = baseUrls.some((url) => isJbcentralProxyUrl(url));
		if (viaJbcentral) jbcentralWired = true;
		// A provider with models is configured iff the registry can resolve auth for it; a model-less
		// credential entry falls back to `hasAuth` (it holds a key, so report it rather than hide it).
		const configured =
			sources.availableProviders.has(id) || (baseUrls.length === 0 && sources.hasAuth(id));
		if (!configured) return { id, name: sources.displayName(id), configured: false };
		const { source, label } = sources.providerAuth(id);
		const kind = resolveKind(viaJbcentral, sources.credentialType(id), source);
		const detail = resolveDetail(kind, source, label);
		return {
			id,
			name: sources.displayName(id),
			configured: true,
			kind,
			...(detail !== undefined ? { detail } : {}),
		};
	});

	providers.sort((a, b) => {
		if (a.configured !== b.configured) return a.configured ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
	return { providers, jbcentralWired };
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
		credentialType: (id) => authStorage.get(id)?.type,
		providerAuth: (id) => modelRegistry.getProviderAuthStatus(id),
		displayName: (id) => modelRegistry.getProviderDisplayName(id),
		hasAuth: (id) => authStorage.hasAuth(id),
	});
}
