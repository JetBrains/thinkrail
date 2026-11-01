import { readFileSync } from "node:fs";
import type { CapacitorConfig } from "@capacitor/cli";

const darkTheme = JSON.parse(
	readFileSync(
		new URL("../../packages/design-tokens/themes/dark.theme.json", import.meta.url),
		"utf8",
	),
) as { colors: { background: string } };

const config: CapacitorConfig = {
	appId: "ai.thinkrail.mobile",
	appName: "ThinkRail",
	webDir: "dist",
	backgroundColor: darkTheme.colors.background,
	ios: { contentInset: "never" },
};

export default config;
