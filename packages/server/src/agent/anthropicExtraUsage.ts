import { type ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ProviderWarning } from "@thinkrail/contracts";

const ANTHROPIC = "anthropic";
const SUBSCRIPTION_KEY_PREFIX = "sk-ant-oat";

export interface ExtraUsageSubject {
	model: { provider: string } | undefined;
	modelRuntime: Pick<ModelRuntime, "checkAuth" | "getAuth">;
	settingsManager: Pick<SettingsManager, "getWarnings">;
}

export function anthropicExtraUsageWarningEnabled(
	settings: Pick<SettingsManager, "getWarnings">,
): boolean {
	return settings.getWarnings().anthropicExtraUsage !== false;
}

export async function anthropicSubscriptionAuthActive(
	modelRuntime: ExtraUsageSubject["modelRuntime"],
): Promise<boolean> {
	try {
		if ((await modelRuntime.checkAuth(ANTHROPIC))?.type === "oauth") return true;
		const apiKey = (await modelRuntime.getAuth(ANTHROPIC))?.auth.apiKey;
		return typeof apiKey === "string" && apiKey.startsWith(SUBSCRIPTION_KEY_PREFIX);
	} catch {
		return false;
	}
}

export async function shouldWarnAnthropicExtraUsage(subject: ExtraUsageSubject): Promise<boolean> {
	if (subject.model?.provider !== ANTHROPIC) return false;
	if (!anthropicExtraUsageWarningEnabled(subject.settingsManager)) return false;
	return anthropicSubscriptionAuthActive(subject.modelRuntime);
}

export function globalProviderWarnings(): Record<ProviderWarning, boolean> {
	const warnings = SettingsManager.create(process.cwd()).getGlobalSettings().warnings;
	return { anthropicExtraUsage: warnings?.anthropicExtraUsage !== false };
}

export async function saveAnthropicExtraUsageWarningOff(): Promise<void> {
	const settings = SettingsManager.create(process.cwd());
	settings.setWarnings({ ...settings.getGlobalSettings().warnings, anthropicExtraUsage: false });
	await settings.flush();
	if (settings.drainErrors().length > 0) throw new Error("pi settings could not be saved");
}
