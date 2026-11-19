import type { ComponentType } from "react";

export interface ChatActionTarget {
	readonly workspaceId: string;
	readonly sessionId: string;
}

export interface ChatAction {
	readonly id: string;
	readonly label: string;
	readonly menuLabel: string;
	readonly icon: ComponentType<{ className?: string | undefined }>;
	readonly run: (target: ChatActionTarget) => void;
}
