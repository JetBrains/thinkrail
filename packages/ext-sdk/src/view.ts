export interface HostContext {
	projectId?: string;
	workspaceId?: string;
	sessionId?: string;
	theme: "light" | "dark";
}

export interface SurfaceProps {
	surfaceId: string;
	host: HostContext;
}
