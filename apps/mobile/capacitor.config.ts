import type { CapacitorConfig } from "@capacitor/cli";
import darkTheme from "@thinkrail/design-tokens/themes/dark.theme.json";

const config: CapacitorConfig = {
	appId: "ai.thinkrail.mobile",
	appName: "ThinkRail",
	webDir: "dist",
	backgroundColor: darkTheme.colors.background,
	ios: { contentInset: "never" },
};

export default config;
