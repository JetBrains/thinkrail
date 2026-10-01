import type {
	GitDiffScope,
	LineSpan,
	ReviewAnchor,
	ReviewAnchorState,
	ReviewCommentStatus,
	ReviewSelector,
} from "@thinkrail/contracts";
import type { ComponentType } from "react";

export interface ResourceDescriptor {
	workspaceId: string;
	path: string;
	mime?: string;
	language?: string;
	text: boolean;
	byteLength?: number;
	scope?: GitDiffScope;
}

export type ResourceContent =
	| { kind: "text"; text: string; hash: string }
	| { kind: "bytes"; url: string; hash: string; byteLength: number }
	| { kind: "absent" };

export interface AnchorDraft {
	selectors: ReviewSelector[];
	label: string;
}

export interface ReviewThread {
	id: string;
	anchor: ReviewAnchor;
	body: string;
	status: ReviewCommentStatus;
	anchorState: ReviewAnchorState;
	stale?: boolean;
}

export interface ReviewThreadActions {
	onSendComment(id: string): Promise<void>;
	onDeleteComment(id: string): Promise<void>;
	onUpdateComment(id: string, body: string): Promise<void>;
}

export interface SurfaceReview {
	threads: ReviewThread[];
	commenting: {
		onSave(draft: AnchorDraft, text: string): Promise<void>;
		onSend(draft: AnchorDraft, text: string): Promise<void>;
	};
	actions: ReviewThreadActions;
	focus: { id: string; anchor: ReviewAnchor } | null;
	onFocusHandled(): void;
}

export interface ResourceViewProps {
	resource: ResourceDescriptor;
	content: ResourceContent;
	review?: SurfaceReview;
	onPlacedThreadIds?(ids: ReadonlySet<string>): void;
	viewState?: unknown;
	onViewState?(state: unknown): void;
}

export interface HunkActions {
	revert(range: { original: LineSpan; modified: LineSpan }): Promise<void>;
	revertFile(): Promise<void>;
	askAgent(range: { original: LineSpan; modified: LineSpan }): {
		draft: AnchorDraft;
		initialText: string;
		notice?: string;
	};
	agentWorking?: boolean;
}

export interface ResourceDiffProps {
	resource: ResourceDescriptor;
	original: ResourceContent;
	modified: ResourceContent;
	layout: "split" | "unified";
	ignoreWhitespace: boolean;
	review?: { worktree: SurfaceReview; base: SurfaceReview };
	hunkActions?: HunkActions;
	onPlacedThreadIds?(ids: ReadonlySet<string>): void;
	viewState?: unknown;
	onViewState?(state: unknown): void;
}

export type ResourceAnchorCapability = "line" | `structural:${string}` | "region";

export interface ResourceRenderer {
	id: string;
	label: string;
	match: {
		glob?: string[];
		mime?: string[];
		language?: string[];
		text?: boolean;
	};
	rank: number;
	capabilities: {
		view: boolean;
		diff: boolean;
		anchors: {
			view: ReadonlyArray<ResourceAnchorCapability>;
			diff: ReadonlyArray<ResourceAnchorCapability>;
		};
		mobile: boolean;
		active: boolean;
	};
	trust: "bundled" | "project" | "user";
	loadView?(): Promise<{ default: ComponentType<ResourceViewProps> }>;
	loadDiff?(): Promise<{ default: ComponentType<ResourceDiffProps> }>;
}

export type ResourceIntent = "view" | "diff";

export interface ResourceEnvironment {
	mobile: boolean;
}
