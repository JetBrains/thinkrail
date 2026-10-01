import {
	RiCheckLine as Check,
	RiFileCopyLine as Copy,
	RiParagraph as Pilcrow,
} from "@remixicon/react";
import type { ResourceMeta } from "@thinkrail/contracts";
import {
	type ComponentType,
	type LazyExoticComponent,
	lazy,
	Suspense,
	useMemo,
	useState,
} from "react";
import { IconTooltip } from "@/components/ui/tooltip";
import { copyText, isPhoneViewport, usePhoneViewport } from "@/lib";
import {
	describeResource,
	type ResourceContent,
	type ResourceDiffProps,
	type ResourceRenderer,
	resolveRenderers,
} from "@/resources";
import { LoadingRegion } from "../components/Skeleton";
import type { DiffTab } from "../store";
import { selectDiffTabTargetRef, useAppStore } from "../store";
import { getTransport } from "../transport";
import { splitPath } from "./changesModel";
import {
	encodeResourcePath,
	PENDING_TEXT_META,
	rendererImplementationKey,
	rendererTestId,
	selectResourceRenderer,
	useResetViewStateOnImplementationChange,
} from "./resourcePane";
import { SendReviewButton } from "./SendReviewButton";
import { ToggleSegment } from "./ToggleSegment";
import { UnplacedReviewStrip } from "./UnplacedReviewStrip";
import { useLiveTabContent } from "./useLiveTabContent";
import { useFileReview } from "./useReviewCommenting";

const loading = <LoadingRegion rows={12} className="h-full p-12" />;

function bytesUrl(workspaceId: string, path: string, oid?: string | null): string {
	const base = getTransport().httpBase();
	const encoded = `${encodeURIComponent(workspaceId)}/${encodeResourcePath(path)}`;
	return oid
		? `${base}/blob/${encodeURIComponent(workspaceId)}/${encodeURIComponent(oid)}/${encodeResourcePath(path)}`
		: `${base}/files/${encoded}`;
}

function descriptorMetaFor(meta: DiffTab["meta"]): ResourceMeta {
	if (!meta) return PENDING_TEXT_META;
	const present = [meta.original, meta.modified].filter((side) => side.hash !== null);
	const representative =
		meta.modified.hash !== null ? meta.modified : (present[0] ?? PENDING_TEXT_META);
	return { ...representative, text: present.every((side) => side.text) };
}

function sideContent(
	text: string,
	meta: ResourceMeta | undefined,
	url: string | null,
): ResourceContent {
	if (!meta) return { kind: "text", text, hash: "" };
	if (meta.hash === null || meta.byteLength === null) return { kind: "absent" };
	if (meta.text) return { kind: "text", text, hash: meta.hash };
	if (!url) return { kind: "absent" };
	return { kind: "bytes", url, hash: meta.hash, byteLength: meta.byteLength };
}

const diffComponents = new Map<string, LazyExoticComponent<ComponentType<ResourceDiffProps>>>();

function RendererDiff({
	renderer,
	implementationKey,
	...props
}: ResourceDiffProps & { renderer: ResourceRenderer; implementationKey: string }) {
	let Component = diffComponents.get(implementationKey);
	if (!Component) {
		if (!renderer.loadDiff) {
			throw new Error(`Resource renderer has no diff loader: ${renderer.id}`);
		}
		Component = lazy(renderer.loadDiff);
		diffComponents.set(implementationKey, Component);
	}
	return <Component {...props} />;
}

export function DiffPane({ tab }: { tab: DiffTab }) {
	const mobile = usePhoneViewport();
	const setTabRenderer = useAppStore((state) => state.setTabRenderer);
	const setDiffTabView = useAppStore((state) => state.setDiffTabView);
	const setDiffTabIgnoreWhitespace = useAppStore((state) => state.setDiffTabIgnoreWhitespace);
	const [copied, setCopied] = useState(false);
	const reviewable = tab.scope.kind !== "commit";
	const review = useFileReview(tab.workspaceId, tab.path, "diff", tab.scope);
	const targetRef = useAppStore((state) => selectDiffTabTargetRef(state, tab));

	useLiveTabContent(
		tab,
		{
			read: () =>
				getTransport().request("git.diffFile", {
					workspaceId: tab.workspaceId,
					path: tab.path,
					scope: tab.scope,
				}),
			applyFresh: ({ original, modified, meta, originalOid }, tick) =>
				useAppStore
					.getState()
					.updateDiffTabContent(
						tab.workspaceId,
						tab.id,
						original,
						modified,
						meta,
						originalOid,
						tick,
						targetRef,
					),
			keepCurrent: (tick) =>
				useAppStore
					.getState()
					.updateDiffTabContent(
						tab.workspaceId,
						tab.id,
						tab.original,
						tab.modified,
						tab.meta,
						tab.originalOid,
						tick,
						tab.loadedTarget,
					),
		},
		targetRef,
		tab.loadedTarget,
	);

	const descriptorMeta = useMemo(() => descriptorMetaFor(tab.meta), [tab.meta]);
	const resource = useMemo(
		() => describeResource(tab.workspaceId, tab.path, descriptorMeta, tab.scope),
		[tab.workspaceId, tab.path, descriptorMeta, tab.scope],
	);
	const candidates = useMemo(
		() => resolveRenderers(resource, "diff", { mobile }),
		[resource, mobile],
	);
	const renderer = selectResourceRenderer(candidates, tab.rendererId, tab.path);
	const implementationKey = rendererImplementationKey(renderer.id, mobile);
	useResetViewStateOnImplementationChange(tab.workspaceId, tab.id, implementationKey);

	const view = mobile ? "inline" : (tab.view ?? "split");
	const ignoreWhitespace = tab.ignoreWhitespace ?? false;
	const original = sideContent(
		tab.original,
		tab.meta?.original,
		tab.originalOid ? bytesUrl(tab.workspaceId, tab.path, tab.originalOid) : null,
	);
	const modifiedOid = tab.scope.kind === "commit" ? tab.scope.sha : null;
	const modified = sideContent(
		tab.modified,
		tab.meta?.modified,
		bytesUrl(tab.workspaceId, tab.path, modifiedOid),
	);
	const { dir, base } = splitPath(tab.path);
	const copy = async () => {
		if (!(await copyText(tab.modified))) return;
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};
	const reviews = reviewable ? [review.worktree, review.base] : [];
	const saveViewState = (state: unknown) => {
		const current = useAppStore
			.getState()
			.tabsByWorkspace[tab.workspaceId]?.find((candidate) => candidate.id === tab.id);
		if (
			current?.kind === "diff" &&
			(current.rendererId === undefined || current.rendererId === renderer.id) &&
			rendererImplementationKey(renderer.id, isPhoneViewport()) === implementationKey
		) {
			useAppStore.getState().setTabViewState(tab.workspaceId, tab.id, state);
		}
	};

	return (
		<div data-testid="diff-pane" className="flex h-full min-h-0 flex-col">
			<div
				data-testid="diff-view-toggle"
				role="toolbar"
				aria-label="Diff view mode"
				className="flex h-32 shrink-0 items-center gap-4 border-border-default border-b bg-container-header-bg px-12"
			>
				<span
					data-testid="diff-path"
					title={tab.path}
					className="mr-auto flex min-w-0 items-baseline tr-code-text"
				>
					{dir ? (
						<span data-testid="diff-path-dir" className="min-w-0 shrink truncate text-text-muted">
							{dir}
						</span>
					) : null}
					<span
						data-testid="diff-path-base"
						className="max-w-full shrink-0 truncate text-text-muted"
					>
						{base}
					</span>
				</span>
				<SendReviewButton workspaceId={tab.workspaceId} path={tab.path} />
				<HeaderIconButton
					testid="diff-toggle-whitespace"
					label="Hide whitespace changes"
					active={ignoreWhitespace}
					onClick={() => setDiffTabIgnoreWhitespace(tab.id, !ignoreWhitespace)}
				>
					<Pilcrow className="size-14" />
				</HeaderIconButton>
				<HeaderIconButton testid="diff-copy" label="Copy file contents" onClick={() => void copy()}>
					{copied ? (
						<Check className="size-14 text-feedback-success" />
					) : (
						<Copy className="size-14" />
					)}
				</HeaderIconButton>
				{candidates.length >= 2
					? candidates.map((candidate) => (
							<ToggleSegment
								key={candidate.id}
								testid={rendererTestId(candidate.id)}
								label={candidate.label}
								active={candidate.id === renderer.id}
								onClick={() => setTabRenderer(tab.workspaceId, tab.id, candidate.id)}
							/>
						))
					: null}
				<ToggleSegment
					testid="diff-toggle-split"
					label="Split"
					active={view === "split"}
					onClick={() => setDiffTabView(tab.id, "split")}
				/>
				<ToggleSegment
					testid="diff-toggle-inline"
					label="Inline"
					active={view === "inline"}
					onClick={() => setDiffTabView(tab.id, "inline")}
				/>
			</div>
			<UnplacedReviewStrip
				reviews={reviews}
				renderer={renderer}
				intent="diff"
				candidates={candidates}
				onSelectRenderer={(rendererId) => setTabRenderer(tab.workspaceId, tab.id, rendererId)}
			/>
			<div className="min-h-0 flex-1">
				<Suspense fallback={loading}>
					<RendererDiff
						key={implementationKey}
						renderer={renderer}
						implementationKey={implementationKey}
						resource={resource}
						original={original}
						modified={modified}
						layout={view === "split" ? "split" : "unified"}
						ignoreWhitespace={ignoreWhitespace}
						{...(reviewable ? { review } : {})}
						viewState={tab.viewState}
						onViewState={saveViewState}
					/>
				</Suspense>
			</div>
		</div>
	);
}

function HeaderIconButton({
	testid,
	label,
	active,
	onClick,
	children,
}: {
	testid: string;
	label: string;
	active?: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<IconTooltip label={label}>
			<button
				type="button"
				data-testid={testid}
				data-active={active}
				aria-pressed={active}
				aria-label={label}
				onClick={onClick}
				className={`flex size-24 items-center justify-center rounded-[var(--radius-sm)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary ${
					active
						? "bg-container-elevated-bg text-text-default"
						: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
				}`}
			>
				{children}
			</button>
		</IconTooltip>
	);
}
