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

export interface ProviderStatusSources {
	modelProviderIds: Set<string>;
	availableProviders: Set<string>;
	credentialProviders: string[];
	oauthProviders: { id: string; name: string }[];
	credentialType: (id: string) => "oauth" | "api_key" | undefined;
	providerAuth: (id: string) => { source?: string; label?: string };
	apiKeyLogin: (id: string) => boolean;
	displayName: (id: string) => string;
	hasAuth: (id: string) => boolean;
	jbcentral: JbcentralStatus;
	jbcentralInstall: JbcentralInstall;
}

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

function resolveDetail(source?: string, label?: string): string | undefined {
	if (label) return label;
	if (source === "models_json_key") return "models.json";
	if (source === "models_json_command") return "models.json (command)";
	return undefined;
}

export function buildProviderReport(sources: ProviderStatusSources): ProviderStatusReport {
	const oauthIds = new Set(sources.oauthProviders.map((p) => p.id));
	const oauthName = new Map(sources.oauthProviders.map((p) => [p.id, p.name]));
	const removable = new Set(sources.credentialProviders);
	const ids = new Set<string>([
		...sources.modelProviderIds,
		...sources.credentialProviders,
		...oauthIds,
	]);
	const providers: ProviderStatus[] = [...ids].map((id) => {
		const registryName = sources.displayName(id);
		const name = registryName === id ? (oauthName.get(id) ?? registryName) : registryName;
		const canOAuth = oauthIds.has(id);
		const canApiKey = sources.apiKeyLogin(id);
		const login = {
			...(canOAuth ? { canOAuth: true } : {}),
			...(canApiKey ? { canApiKey: true } : {}),
			...(removable.has(id) ? { canLogout: true } : {}),
		};
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
