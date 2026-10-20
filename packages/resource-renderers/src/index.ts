export {
	type MarkdownRehypePlugins,
	type ResourceCodeHost,
	type ResourceCodeLanguage,
	ResourceEnvironmentProvider,
	type ResourceFileReviewProps,
	type ResourceHost,
	ResourceHostProvider,
	type ResourceMarkdown,
	type ResourceMarkdownProps,
	type ResourcePreferences,
	ResourcePreferencesProvider,
	type ResourceReviewSendProps,
	type ResourceScope,
	ResourceScopeProvider,
	useOptionalResourceHost,
	useResourceHost,
	useResourceScope,
} from "./host";
export {
	type AnchorDraft,
	anchorLabel,
	canonicalWorkspacePath,
	describeResource,
	diffResourceMeta,
	type HunkActions,
	type HunkTriage,
	isPlaceable,
	outdatedReason,
	PENDING_TEXT_META,
	type ResourceAnchorCapability,
	type ResourceContent,
	type ResourceDescriptor,
	type ResourceDiffProps,
	type ResourceEnvironment,
	type ResourceIntent,
	type ResourceRenderer,
	type ResourceViewProps,
	type ReviewThread,
	type ReviewThreadActions,
	registerResourceRenderer,
	rendererImplementationKey,
	rendererTestId,
	resolveRenderers,
	resourceContent,
	type SurfaceReview,
	selectResourceRenderer,
	threadLabel,
} from "./registry";
export { createAskAgentRequest } from "./renderers/code/changeBlocks";
export { registerBundledResourceRenderers } from "./renderers/register";
export { ReviewDraftContext, type ReviewDraftPersistence } from "./renderers/reviewDraftState";
export { ExpensiveDiffNotice } from "./support/ExpensiveDiffNotice";
export { GuardedRendererDiff } from "./support/GuardedRendererDiff";
export {
	estimateChangedLines,
	isDiffTooExpensive,
	LARGE_DIFF_CHANGED_LINES,
	surfaceChangedLines,
	surfaceLineCount,
	VIRTUALIZED_DIFF_LINES,
} from "./support/largeDiff";
export { type RendererLayout, RendererToggles } from "./support/RendererToggles";
export {
	ResourcePreview,
	type ResourcePreviewLayout,
	type ResourcePreviewProps,
} from "./support/ResourcePreview";
export { ReviewThreadCard } from "./support/ReviewThreadCard";
export {
	RendererDiff,
	RendererView,
	usePlacedThreadIds,
	useRendererSelection,
} from "./support/rendererMount";
export {
	focusedUnplacedEntry,
	type UnplacedReviewEntry,
	UnplacedReviewStrip,
	unplacedReviewEntries,
} from "./support/UnplacedReviewStrip";
