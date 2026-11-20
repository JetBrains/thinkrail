import type { ComponentType, ReactNode } from "react";

export type ResourcePreviewLayout = "split" | "unified";

export type HtmlViewport = "desktop" | "tablet" | "phone" | "responsive";

export type FrameFocus = "auto" | "manual";

export interface ResourceReveal {
	line: number;
	column?: number;
	length?: number;
	tick: number;
}

export interface DiffSideLabels {
	original: string;
	modified: string;
}

export interface ResourcePreviewProps {
	path: string;
	before?: string | undefined;
	workspaceId?: string | undefined;
	rendererId?: string | undefined;
	onRendererId?: ((rendererId: string) => void) | undefined;
	layout?: ResourcePreviewLayout | undefined;
	onLayout?: ((layout: ResourcePreviewLayout) => void) | undefined;
	viewState?: unknown;
	onViewState?: ((viewState: unknown) => void) | undefined;
	reveal?: ResourceReveal | undefined;
	leading?: ReactNode;
	actions?: ReactNode;
	className?: string | undefined;
	compact?: boolean | undefined;
	htmlViewport?: HtmlViewport | undefined;
	frameFocus?: FrameFocus | undefined;
	sideLabels?: DiffSideLabels | undefined;
	reviewable?: boolean | undefined;
}

export interface FramedResourcePreviewProps {
	path: string;
	before?: string | undefined;
	title: string;
	frameClassName: string;
	compact?: boolean | undefined;
	frameFocus?: FrameFocus | undefined;
	testIdPrefix: string;
	onFullscreen?: (() => void) | undefined;
}

export interface ResourceScope {
	workspaceId: string;
	sessionId?: string | undefined;
}

export interface ResourceMarkdownProps {
	text: string;
	className?: string;
}

export interface ResourceHost {
	markdown: ComponentType<ResourceMarkdownProps>;
	openFile(workspaceId: string, path: string, options?: { keep?: boolean }): void;
	openComparison(workspaceId: string, before: string, path: string): void;
}

export declare function ResourcePreview(props: ResourcePreviewProps): ReactNode;

export declare function FramedResourcePreview(props: FramedResourcePreviewProps): ReactNode;

export declare function useResourceScope(): ResourceScope | null;

export declare function useOptionalResourceHost(): ResourceHost | null;
