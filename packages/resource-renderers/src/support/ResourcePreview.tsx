import type { ResourceMeta } from "@thinkrail/contracts";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { useResourceEnvironment, useResourceHost, useResourceScope } from "../host";
import {
	canonicalWorkspacePath,
	describeResource,
	type ResourceRenderer,
	rendererImplementationKey,
	rendererTestId,
	resolveRenderers,
	type SurfaceReview,
	selectResourceRenderer,
} from "../registry";
import { ExpensiveDiffNotice } from "./ExpensiveDiffNotice";
import { isDiffTooExpensive, surfaceLineCount, VIRTUALIZED_DIFF_LINES } from "./largeDiff";
import { RendererDiff, RendererView, usePlacedThreadIds } from "./rendererMount";
import { UnplacedReviewStrip } from "./UnplacedReviewStrip";
import { type LoadedFile, type ReadyFile, startWorkspaceFileReads } from "./workspaceFileReads";

interface FileState {
	file: string;
	loaded: LoadedFile;
}

export type ResourcePreviewLayout = "split" | "unified";

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
	leading?: ReactNode;
	actions?: ReactNode;
	className?: string | undefined;
}

interface ResolvedProps extends ResourcePreviewProps {
	workspaceId: string;
	sessionId: string | undefined;
	rendererId: string | undefined;
	onRendererId: (rendererId: string) => void;
}

const LOADING: LoadedFile = { status: "loading" };

function implementationViewState(
	props: Pick<ResourcePreviewProps, "viewState" | "onViewState">,
	implementation: string,
): { viewState: unknown; onViewState?: (state: unknown) => void } {
	const { viewState, onViewState } = props;
	const own =
		typeof viewState === "object" &&
		viewState !== null &&
		Reflect.get(viewState, "implementation") === implementation;
	return {
		viewState: own ? Reflect.get(viewState, "state") : undefined,
		...(onViewState
			? { onViewState: (state: unknown) => onViewState({ implementation, state }) }
			: {}),
	};
}

const loading = <LoadingRegion rows={8} className="h-full p-12" />;

function useWorkspaceFile(workspaceId: string, path: string | undefined): LoadedFile {
	const { readFile, subscribeFileChanges, bytesUrl } = useResourceHost();
	const [state, setState] = useState<FileState | null>(null);
	const fileKey = `${workspaceId}\u0000${path ?? ""}`;

	useEffect(() => {
		if (path === undefined) return;
		return startWorkspaceFileReads({
			read: () => readFile(workspaceId, path),
			subscribe: (onChange) =>
				subscribeFileChanges(workspaceId, (paths) => {
					if (paths === null || paths.includes(path)) onChange();
				}),
			bytesUrl: () => bytesUrl(workspaceId, path),
			update: (next) =>
				setState((current) => ({
					file: fileKey,
					loaded: next(current?.file === fileKey ? current.loaded : null),
				})),
		});
	}, [readFile, subscribeFileChanges, bytesUrl, workspaceId, path, fileKey]);

	return state?.file === fileKey ? state.loaded : LOADING;
}

function diffDescriptorMeta(original: ResourceMeta, modified: ResourceMeta): ResourceMeta {
	return { ...modified, text: original.text && modified.text };
}

export function ResourcePreview(props: ResourcePreviewProps) {
	const scope = useResourceScope();
	const workspaceId = props.workspaceId ?? scope?.workspaceId;
	if (!workspaceId)
		throw new Error("ResourcePreview needs a workspace: pass workspaceId or a scope");
	const sessionId = scope?.workspaceId === workspaceId ? scope.sessionId : undefined;
	return <ScopedResourcePreview {...props} workspaceId={workspaceId} sessionId={sessionId} />;
}

function ScopedResourcePreview(
	props: ResourcePreviewProps & { workspaceId: string; sessionId: string | undefined },
) {
	const [localRenderer, setLocalRenderer] = useState<string | undefined>(undefined);
	const resolved: ResolvedProps = {
		...props,
		path: canonicalWorkspacePath(props.path),
		before: props.before === undefined ? undefined : canonicalWorkspacePath(props.before),
		rendererId: props.onRendererId ? props.rendererId : localRenderer,
		onRendererId: props.onRendererId ?? setLocalRenderer,
	};
	const { workspaceId, path, before } = resolved;
	const modified = useWorkspaceFile(workspaceId, path);
	const original = useWorkspaceFile(workspaceId, before);
	const failure =
		modified.status === "error"
			? { path, message: modified.message }
			: before !== undefined && original.status === "error"
				? { path: before, message: original.message }
				: null;

	if (failure) {
		return (
			<div
				data-testid="resource-preview-error"
				className="rounded-sm border border-border-default px-8 py-4 text-feedback-error tr-text-metadata"
			>
				Couldn't load {failure.path}: {failure.message}
			</div>
		);
	}
	if (modified.status !== "ready" || (before !== undefined && original.status !== "ready")) {
		return <div className={props.className}>{loading}</div>;
	}
	return before !== undefined && original.status === "ready" ? (
		<PreviewDiff {...resolved} before={before} original={original} modified={modified} />
	) : (
		<PreviewView {...resolved} file={modified} />
	);
}

function PreviewFrame({
	testid,
	className,
	toolbar,
	strip,
	children,
}: {
	testid: string;
	className: string | undefined;
	toolbar: ReactNode;
	strip: ReactNode;
	children: ReactNode;
}) {
	return (
		<div
			data-testid={testid}
			className={cn("flex min-h-0 flex-col overflow-hidden bg-container-workspace-bg", className)}
		>
			{toolbar}
			{strip}
			<div className="min-h-0 flex-1">
				<Suspense fallback={loading}>{children}</Suspense>
			</div>
		</div>
	);
}

function PreviewToolbar({
	props,
	paths,
	candidates,
	renderer,
	reviews,
}: {
	props: ResolvedProps;
	paths: readonly string[];
	candidates: readonly ResourceRenderer[];
	renderer: ResourceRenderer;
	reviews: readonly SurfaceReview[];
}) {
	const { ReviewSend } = useResourceHost();
	const { workspaceId, sessionId, layout, onLayout } = props;
	const hasDraft = reviews.some((review) =>
		review.threads.some((thread) => thread.status === "draft"),
	);
	const showLayout = layout !== undefined && onLayout !== undefined && renderer.capabilities.layout;
	if (candidates.length < 2 && !hasDraft && !props.actions && !props.leading && !showLayout) {
		return null;
	}
	return (
		<div
			data-testid="resource-view-toggle"
			role="toolbar"
			aria-label="Resource view"
			className="flex h-32 shrink-0 items-center gap-4 border-border-default border-b bg-container-header-bg px-12"
		>
			<div className="mr-auto flex min-w-0 items-center">{props.leading}</div>
			<ReviewSend workspaceId={workspaceId} paths={paths} sessionId={sessionId} />
			{candidates.length >= 2
				? candidates.map((candidate) => (
						<ToggleSegment
							key={candidate.id}
							testid={rendererTestId(candidate.id)}
							label={candidate.label}
							active={candidate.id === renderer.id}
							onClick={() => props.onRendererId(candidate.id)}
						/>
					))
				: null}
			{showLayout ? (
				<>
					<ToggleSegment
						testid="diff-toggle-split"
						label="Split"
						active={layout === "split"}
						onClick={() => onLayout("split")}
					/>
					<ToggleSegment
						testid="diff-toggle-inline"
						label="Inline"
						active={layout === "unified"}
						onClick={() => onLayout("unified")}
					/>
				</>
			) : null}
			{props.actions}
		</div>
	);
}

function PreviewView(props: ResolvedProps & { file: ReadyFile }) {
	const { FileReview } = useResourceHost();
	return (
		<FileReview
			workspaceId={props.workspaceId}
			path={props.path}
			kind="inline"
			sessionId={props.sessionId}
		>
			{(review) => <ReviewedPreviewView {...props} review={review} />}
		</FileReview>
	);
}

function ReviewedPreviewView(props: ResolvedProps & { file: ReadyFile; review: SurfaceReview }) {
	const { workspaceId, path, file, rendererId, onRendererId, review } = props;
	const { mobile } = useResourceEnvironment();
	const resource = useMemo(
		() => describeResource(workspaceId, path, file.meta),
		[workspaceId, path, file.meta],
	);
	const candidates = useMemo(
		() => resolveRenderers(resource, "view", { mobile }),
		[resource, mobile],
	);
	const renderer = selectResourceRenderer(candidates, rendererId, path);
	const implementationKey = rendererImplementationKey(renderer.id, mobile);
	const { placedThreadIds, onPlacedThreadIds } = usePlacedThreadIds(implementationKey);
	const paths = useMemo(() => [path], [path]);
	const reviews = useMemo(() => [review], [review]);

	return (
		<PreviewFrame
			testid="resource-preview"
			className={props.className}
			toolbar={
				<PreviewToolbar
					props={props}
					paths={paths}
					candidates={candidates}
					renderer={renderer}
					reviews={reviews}
				/>
			}
			strip={
				<UnplacedReviewStrip
					reviews={reviews}
					renderer={renderer}
					intent="view"
					candidates={candidates}
					{...(placedThreadIds ? { placedThreadIds } : {})}
					onSelectRenderer={onRendererId}
				/>
			}
		>
			<RendererView
				key={implementationKey}
				renderer={renderer}
				implementationKey={implementationKey}
				mobile={mobile}
				resource={resource}
				content={file.content}
				review={review}
				onPlacedThreadIds={onPlacedThreadIds}
				{...implementationViewState(props, implementationKey)}
			/>
		</PreviewFrame>
	);
}

type DiffSides = { before: string; original: ReadyFile; modified: ReadyFile };

function PreviewDiff(props: ResolvedProps & DiffSides) {
	const { FileReview } = useResourceHost();
	const { workspaceId, sessionId, path, before } = props;
	return (
		<FileReview workspaceId={workspaceId} path={path} kind="diff" sessionId={sessionId}>
			{(after) => (
				<FileReview workspaceId={workspaceId} path={before} kind="diff" sessionId={sessionId}>
					{(prior) => <ReviewedPreviewDiff {...props} after={after} prior={prior} />}
				</FileReview>
			)}
		</FileReview>
	);
}

function ReviewedPreviewDiff(
	props: ResolvedProps & DiffSides & { after: SurfaceReview; prior: SurfaceReview },
) {
	const { workspaceId, path, before, original, modified, rendererId, onRendererId, after, prior } =
		props;
	const { mobile } = useResourceEnvironment();
	const review = useMemo(() => ({ worktree: after, base: prior }), [after, prior]);
	const descriptorMeta = useMemo(
		() => diffDescriptorMeta(original.meta, modified.meta),
		[original.meta, modified.meta],
	);
	const resource = useMemo(
		() => describeResource(workspaceId, path, descriptorMeta),
		[workspaceId, path, descriptorMeta],
	);
	const originalResource = useMemo(
		() => describeResource(workspaceId, before, original.meta),
		[workspaceId, before, original.meta],
	);
	const candidates = useMemo(
		() => resolveRenderers(resource, "diff", { mobile }),
		[resource, mobile],
	);
	const renderer = selectResourceRenderer(candidates, rendererId, path);
	const implementationKey = rendererImplementationKey(renderer.id, mobile);
	const { placedThreadIds, onPlacedThreadIds } = usePlacedThreadIds(implementationKey);
	const paths = useMemo(() => [path, before], [path, before]);
	const reviews = useMemo(() => [after, prior], [after, prior]);
	const layout = mobile ? "unified" : (props.layout ?? "unified");
	const tooExpensive = useMemo(
		() => isDiffTooExpensive(original.content, modified.content),
		[original.content, modified.content],
	);
	const lineCount = useMemo(
		() => surfaceLineCount(original.content, modified.content),
		[original.content, modified.content],
	);
	const [showAnyway, setShowAnyway] = useState(false);

	return (
		<PreviewFrame
			testid="resource-preview-diff"
			className={props.className}
			toolbar={
				<PreviewToolbar
					props={props}
					paths={paths}
					candidates={candidates}
					renderer={renderer}
					reviews={reviews}
				/>
			}
			strip={
				<UnplacedReviewStrip
					reviews={reviews}
					renderer={renderer}
					intent="diff"
					candidates={candidates}
					{...(placedThreadIds ? { placedThreadIds } : {})}
					onSelectRenderer={onRendererId}
				/>
			}
		>
			{tooExpensive && !showAnyway ? (
				<ExpensiveDiffNotice onShowAnyway={() => setShowAnyway(true)} />
			) : (
				<RendererDiff
					key={implementationKey}
					renderer={renderer}
					implementationKey={implementationKey}
					resource={resource}
					originalResource={originalResource}
					original={original.content}
					modified={modified.content}
					layout={layout}
					ignoreWhitespace={false}
					review={review}
					onPlacedThreadIds={onPlacedThreadIds}
					virtualize={lineCount > VIRTUALIZED_DIFF_LINES}
					{...implementationViewState(props, implementationKey)}
				/>
			)}
		</PreviewFrame>
	);
}
