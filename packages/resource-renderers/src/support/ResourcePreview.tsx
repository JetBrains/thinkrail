import { useT } from "@thinkrail/locales/react";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { useResourceHost, useResourceScope } from "../host";
import {
	canonicalWorkspacePath,
	describeResource,
	diffResourceMeta,
	type ResourceRenderer,
	type SurfaceReview,
} from "../registry";
import { GuardedRendererDiff } from "./GuardedRendererDiff";
import { surfaceLineCount } from "./largeDiff";
import { type RendererLayout, RendererToggles } from "./RendererToggles";
import { RendererView, useRendererSelection } from "./rendererMount";
import { UnplacedReviewStrip } from "./UnplacedReviewStrip";
import {
	type FileState,
	type LoadedFile,
	type ReadyFile,
	startWorkspaceFileReads,
	updateFileState,
} from "./workspaceFileReads";

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
			update: (next) => setState((current) => updateFileState(current, fileKey, next)),
		});
	}, [readFile, subscribeFileChanges, bytesUrl, workspaceId, path, fileKey]);

	return state?.file === fileKey ? state.loaded : LOADING;
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
	const t = useT();
	const [localRenderer, setLocalRenderer] = useState<string | undefined>(undefined);
	const path = canonicalWorkspacePath(props.path);
	const requested = props.before === undefined ? undefined : canonicalWorkspacePath(props.before);
	const before = requested === path ? undefined : requested;
	const resolved: ResolvedProps = {
		...props,
		path,
		before,
		rendererId: props.onRendererId ? props.rendererId : localRenderer,
		onRendererId: props.onRendererId ?? setLocalRenderer,
	};
	const { workspaceId } = resolved;
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
				{t("viewer.preview.loadFailed", { path: failure.path, message: failure.message })}
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

function StaleNotice({ files }: { files: readonly { path: string; file: ReadyFile }[] }) {
	const t = useT();
	const stale = files.filter(({ file }) => file.stale !== undefined);
	if (stale.length === 0) return null;
	return (
		<div
			data-testid="resource-preview-stale"
			role="status"
			className="shrink-0 border-border-default border-b bg-feedback-warning-subtle px-12 py-4 tr-text-metadata text-feedback-warning"
		>
			{stale.map(({ path, file }) => (
				<p key={path}>{t("viewer.preview.refreshFailed", { path, message: file.stale })}</p>
			))}
		</div>
	);
}

function PreviewFrame({
	testid,
	className,
	toolbar,
	notice,
	strip,
	children,
}: {
	testid: string;
	className: string | undefined;
	toolbar: ReactNode;
	notice: ReactNode;
	strip: ReactNode;
	children: ReactNode;
}) {
	return (
		<div
			data-testid={testid}
			className={cn("flex min-h-0 flex-col overflow-hidden bg-container-workspace-bg", className)}
		>
			{toolbar}
			{notice}
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
	layout,
}: {
	props: ResolvedProps;
	paths: readonly string[];
	candidates: readonly ResourceRenderer[];
	renderer: ResourceRenderer;
	layout?: { value: RendererLayout; onChange: (layout: RendererLayout) => void } | undefined;
}) {
	const t = useT();
	const { ReviewSend } = useResourceHost();
	return (
		<div
			data-testid="resource-view-toggle"
			role="toolbar"
			aria-label={t("panels.filePane.resourceView")}
			className="flex h-32 shrink-0 items-center gap-4 border-border-default border-b bg-container-header-bg px-12"
		>
			<div className="mr-auto flex min-w-0 items-center">{props.leading}</div>
			<ReviewSend workspaceId={props.workspaceId} paths={paths} sessionId={props.sessionId} />
			<RendererToggles
				candidates={candidates}
				renderer={renderer}
				onRendererId={props.onRendererId}
				layout={layout}
			/>
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

function ReviewedPreviewView(
	props: ResolvedProps & { file: ReadyFile; review: SurfaceReview | undefined },
) {
	const { workspaceId, path, file, rendererId, onRendererId, review } = props;
	const resource = useMemo(
		() => describeResource(workspaceId, path, file.meta),
		[workspaceId, path, file.meta],
	);
	const { mobile, candidates, renderer, implementationKey, placedThreadIds, onPlacedThreadIds } =
		useRendererSelection(resource, "view", rendererId);
	const paths = useMemo(() => [path], [path]);
	const reviews = useMemo(() => (review ? [review] : []), [review]);

	return (
		<PreviewFrame
			testid="resource-preview"
			className={props.className}
			notice={<StaleNotice files={[{ path, file }]} />}
			toolbar={
				<PreviewToolbar props={props} paths={paths} candidates={candidates} renderer={renderer} />
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
				mobile={mobile}
				resource={resource}
				content={file.content}
				{...(review ? { review } : {})}
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
	props: ResolvedProps &
		DiffSides & { after: SurfaceReview | undefined; prior: SurfaceReview | undefined },
) {
	const { workspaceId, path, before, original, modified, rendererId, onRendererId, after, prior } =
		props;
	const review = useMemo(
		() => (after && prior ? { worktree: after, base: prior } : undefined),
		[after, prior],
	);
	const descriptorMeta = useMemo(
		() => diffResourceMeta(original.meta, modified.meta),
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
	const { mobile, candidates, renderer, implementationKey, placedThreadIds, onPlacedThreadIds } =
		useRendererSelection(resource, "diff", rendererId);
	const paths = useMemo(() => [path, before], [path, before]);
	const reviews = useMemo(() => (after && prior ? [after, prior] : []), [after, prior]);
	const layout = mobile ? "unified" : (props.layout ?? "unified");
	const { onLayout } = props;
	const lineCount = useMemo(
		() => surfaceLineCount(original.content, modified.content),
		[original.content, modified.content],
	);

	return (
		<PreviewFrame
			testid="resource-preview-diff"
			className={props.className}
			notice={
				<StaleNotice
					files={[
						{ path: before, file: original },
						{ path, file: modified },
					]}
				/>
			}
			toolbar={
				<PreviewToolbar
					props={props}
					paths={paths}
					candidates={candidates}
					renderer={renderer}
					layout={
						props.layout !== undefined && onLayout
							? { value: props.layout, onChange: onLayout }
							: undefined
					}
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
			<GuardedRendererDiff
				renderer={renderer}
				implementationKey={implementationKey}
				resource={resource}
				originalResource={originalResource}
				original={original.content}
				modified={modified.content}
				layout={layout}
				ignoreWhitespace={false}
				{...(review ? { review } : {})}
				onPlacedThreadIds={onPlacedThreadIds}
				lineCount={lineCount}
				{...implementationViewState(props, implementationKey)}
			/>
		</PreviewFrame>
	);
}
