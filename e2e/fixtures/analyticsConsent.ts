import type { BrowserContext, Page, WebSocketRoute } from "@playwright/test";
import { type AppConfig, type ServerWelcome, WS_CHANNELS } from "@thinkrail/contracts";
import { E2eWire } from "./wire";

export const CONFIRMED_ANALYTICS_CONFIG = {
	analyticsEnabled: false,
	analyticsConsentConfirmed: true,
};

export const E2E_BASE_CONFIG = {
	...CONFIRMED_ANALYTICS_CONFIG,
	onboardingDismissed: true,
	otherAgentSkills: false,
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

export function relayWelcome(
	socket: WebSocketRoute,
	edit: (welcome: ServerWelcome) => void = (welcome) => {
		welcome.additionalAnalytics = true;
	},
): void {
	const server = socket.connectToServer();
	server.onMessage((message) => {
		const frame = JSON.parse(String(message)) as { channel?: string; data: ServerWelcome };
		if (frame.channel !== WS_CHANNELS.serverWelcome) {
			socket.send(message);
			return;
		}
		edit(frame.data);
		socket.send(JSON.stringify(frame));
	});
}

export async function offerAdditionalAnalytics(target: Page | BrowserContext): Promise<void> {
	await target.routeWebSocket(/\/ws(\?|$)/, (socket) => relayWelcome(socket));
}
