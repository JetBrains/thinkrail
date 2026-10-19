import type { ResourceMeta } from "@thinkrail/contracts";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { type ResourceHost, useResourceEnvironment, useResourceHost } from "../host";
import {
	describeResource,
	type ResourceContent,
	type ResourceRenderer,
	rendererImplementationKey,
	rendererTestId,
	resolveRenderers,
	type SurfaceReview,
	selectResourceRenderer,
} from "../registry";
import { RendererDiff, RendererView, usePlacedThreadIds } from "./rendererMount";
import { UnplacedReviewStrip } from "./UnplacedReviewStrip";

type LoadedFile =
	| { status: "loading" }
	| { status: "ready"; content: ResourceContent; meta: ResourceMeta }
	| { status: "error"; message: string };

type ReadyFile = Extract<LoadedFile, { status: "ready" }>;

export type ResourcePreviewLayout = "split" | "unified";

export interface ResourcePreviewProps {
	path: string;
	before?: string | undefined;
	workspaceId?: string | undefined;
	rendererId?: string | undefined;
	onRendererId?: ((rendererId: string) => void) | undefined;
	layout?: ResourcePreviewLayout | undefined;
	onLayout?: ((layout: ResourcePreviewLayout) => void) | undefined;
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

const loading = <LoadingRegion rows={8} className="h-full p-12" />;

function fileContent(
	host: ResourceHost,
	workspaceId: string,
	path: string,
	text: string,
	meta: ResourceMeta,
): ResourceContent {
	if (meta.hash === null || meta.byteLength === null) return { kind: "absent" };
	if (meta.text) return { kind: "text", text, hash: meta.hash };
	return {
		kind: "bytes",
		url: host.bytesUrl(workspaceId, path),
		hash: meta.hash,
		byteLength: meta.byteLength,
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function useWorkspaceFile(workspaceId: string, path: string | undefined): LoadedFile {
	const host = useResourceHost();
	const [revision, setRevision] = useState(0);
	const [loaded, setLoaded] = useState<{ file: string; key: string; loaded: LoadedFile } | null>(
		null,
	);
	const fileKey = `${workspaceId}\u0000${path ?? ""}`;
	const key = `${fileKey}\u0000${revision}`;

	useEffect(() => {
		if (path === undefined) return;
		return host.subscribeFileChanges(workspaceId, (paths) => {
			if (paths === null || paths.includes(path)) setRevision((current) => current + 1);
		});
	}, [host, workspaceId, path]);

	useEffect(() => {
		if (path === undefined) return;
		let cancelled = false;
		host.readFile(workspaceId, path).then(
			({ content, meta }) => {
				if (cancelled) return;
				const file: LoadedFile = {
					status: "ready",
					content: fileContent(host, workspaceId, path, content, meta),
					meta,
				};
				setLoaded({ file: fileKey, key, loaded: file });
			},
			(error: unknown) => {
				if (cancelled) return;
				setLoaded({
					file: fileKey,
					key,
					loaded: { status: "error", message: errorMessage(error) },
				});
			},
		);
		return () => {
			cancelled = true;
		};
	}, [host, workspaceId, path, fileKey, key]);

	if (!loaded || loaded.file !== fileKey) return LOADING;
	if (loaded.key === key || loaded.loaded.status === "ready") return loaded.loaded;
	return LOADING;
}

function diffDescriptorMeta(original: ResourceMeta, modified: ResourceMeta): ResourceMeta {
	return { ...modified, text: original.text && modified.text };
}

export function ResourcePreview(props: ResourcePreviewProps) {
	const host = useResourceHost();
	const workspaceId = props.workspaceId ?? host.scope?.workspaceId;
	if (!workspaceId)
		throw new Error("ResourcePreview needs a workspace: pass workspaceId or a scope");
	return (
		<ScopedResourcePreview {...props} workspaceId={workspaceId} sessionId={host.scope?.sessionId} />
	);
}

function ScopedResourcePreview(
	props: ResourcePreviewProps & { workspaceId: string; sessionId: string | undefined },
) {
	const [localRenderer, setLocalRenderer] = useState<string | undefined>(undefined);
	const resolved: ResolvedProps = {
		...props,
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
			<RendererDiff
				key={implementationKey}
				renderer={renderer}
				implementationKey={implementationKey}
				resource={resource}
				original={original.content}
				modified={modified.content}
				layout={layout}
				ignoreWhitespace={false}
				review={review}
				onPlacedThreadIds={onPlacedThreadIds}
			/>
		</PreviewFrame>
	);
}
