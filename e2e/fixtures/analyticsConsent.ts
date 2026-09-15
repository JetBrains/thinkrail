import type { AppConfig } from "@thinkrail/contracts";
import { E2eWire } from "./wire";

export const CONFIRMED_ANALYTICS_CONFIG = {
	analyticsEnabled: false,
	analyticsConsentConfirmed: true,
};

export async function seedAnalyticsConsent(
	baseURL: string | undefined,
	analyticsEnabled: boolean,
	analyticsConsentConfirmed: boolean,
): Promise<AppConfig> {
	if (!baseURL) throw new Error("Analytics consent fixtures require the isolated host URL");
	const wire = await E2eWire.connect(Number(new URL(baseURL).port));
	try {
		return await wire.request("settings.update", {
			config: { analyticsEnabled, analyticsConsentConfirmed },
		});
	} finally {
		wire.close();
	}
}
