import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";
import darkTheme from "@thinkrail/design-tokens/themes/dark.theme.json";

const config: CapacitorConfig = {
	appId: "ai.thinkrail.mobile",
	appName: "ThinkRail",
	webDir: "../web/dist-phone",
	backgroundColor: darkTheme.colors.background,
	ios: { contentInset: "never", scrollEnabled: false },
	server: { androidScheme: "http" },
	plugins: { Keyboard: { resize: KeyboardResize.Native, resizeOnFullScreen: true } },
};

export default config;
