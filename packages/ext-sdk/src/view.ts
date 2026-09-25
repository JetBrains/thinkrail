import type { HostContext } from "@thinkrail/contracts";

export type { HostContext };

export interface SurfaceProps {
	surfaceId: string;
	host: HostContext;
}

export declare const useChannel: <T>(key: string) => T | undefined;
export declare const useAction: (id: string) => (payload?: unknown) => Promise<unknown>;
export declare const useHostContext: () => HostContext;
export declare const openSurface: (
	ext: string,
	surfaceId: string,
	params?: Record<string, string>,
) => void;
export declare const ui: Readonly<Record<string, unknown>>;
export declare const cn: (...inputs: unknown[]) => string;
