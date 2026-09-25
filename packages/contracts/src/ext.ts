export const SURFACE_SLOTS = ["tab", "panel", "status", "toolCard", "message"] as const;
export type SurfaceSlot = (typeof SURFACE_SLOTS)[number];

export interface ExtensionSurface {
	id: string;
	slot: SurfaceSlot;
	title?: string;
	tool?: string;
	customType?: string;
}

export type ExtensionScope = "user" | "project";
export type ExtensionStatus = "active" | "error";

export interface ExtensionInfo {
	name: string;
	title: string;
	scope: ExtensionScope;
	projectId?: string;
	status: ExtensionStatus;
	generation: number | null;
	surfaces: ExtensionSurface[];
	permissions: string[];
	error?: string;
}
