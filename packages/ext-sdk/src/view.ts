import type * as Remixicon from "@remixicon/react";
import type {
	ExtMessageView,
	ExtSurfaceProps,
	ExtThemeMode,
	ExtThemeOverlay,
	ExtThemePreviewResult,
	ExtThemeToken,
	ExtThemeTokens,
	ExtToolCallView,
	ExtViewTheme,
	HostContext,
	SessionStats,
} from "@thinkrail/contracts";
import type { ExtViewUi } from "./viewUi";

export type {
	ButtonProps,
	CommandItemProps,
	ContentProps,
	MenuItemProps,
	RootProps,
	SwitchProps,
	TriggerProps,
} from "./viewUi";
export type {
	ExtMessageView,
	ExtThemeMode,
	ExtThemeOverlay,
	ExtThemePreviewResult,
	ExtThemeToken,
	ExtThemeTokens,
	ExtToolCallView,
	ExtViewTheme,
	ExtViewUi,
	HostContext,
	SessionStats,
};

export type SurfaceProps = ExtSurfaceProps;

export declare const useChannel: <T>(key: string) => T | undefined;
export declare const useAction: (id: string) => (payload?: unknown) => Promise<unknown>;
export declare const useHostContext: () => HostContext;
export declare const openSurface: (
	ext: string,
	surfaceId: string,
	params?: Record<string, string>,
) => void;
export declare const startChat: (draft: string) => Promise<void>;
export declare const useTheme: () => ExtViewTheme;
export declare const ui: ExtViewUi;
export declare const cn: (...inputs: unknown[]) => string;
export declare const remixicon: typeof Remixicon;
