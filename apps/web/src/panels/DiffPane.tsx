import {
	RiCheckLine as Check,
	RiFileCopyLine as Copy,
	RiParagraph as Pilcrow,
	RiArrowGoBackLine as Revert,
} from "@remixicon/react";
import type { ChangeReceipt, ResourceMeta } from "@thinkrail/contracts";
import {
	type ComponentType,
	type LazyExoticComponent,
	lazy,
	Suspense,
	useCallback,
	useMemo,
	useState,
} from "react";
import { IconTooltip } from "@/components/ui/tooltip";
import { copyText, isPhoneViewport, usePhoneViewport } from "@/lib";
import {
	describeResource,
	type HunkActions,
	type ResourceContent,
	type ResourceDiffProps,
	type ResourceRenderer,
	resolveRenderers,
} from "@/resources";
import { LoadingRegion } from "../components/Skeleton";
import type { DiffTab } from "../store";
import { selectDiffTabTargetRef, selectWorkspaceIsRunning, toast, useAppStore } from "../store";
import { errorText, getTransport, wsErrorCode } from "../transport";
import { canOfferChangeMutations, scopeHasMutableModifiedSide } from "./changeMutationAvailability";
import { splitPath } from "./changesModel";
import {
	encodeResourcePath,
	PENDING_TEXT_META,
	rendererImplementationKey,
	rendererTestId,
	selectResourceRenderer,
	useResetViewStateOnImplementationChange,
} from "./resourcePane";
import { createAskAgentRequest } from "./resources/code/changeBlocks";
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

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
	if (left.size !== right.size) return false;
	for (const id of left) if (!right.has(id)) return false;
	return true;
}

export function DiffPane({ tab }: { tab: DiffTab }) {
	const mobile = usePhoneViewport();
	const setTabRenderer = useAppStore((state) => state.setTabRenderer);
	const setDiffTabView = useAppStore((state) => state.setDiffTabView);
	const setDiffTabIgnoreWhitespace = useAppStore((state) => state.setDiffTabIgnoreWhitespace);
	const [copied, setCopied] = useState(false);
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const mutationExpect = useMemo(
		() =>
			tab.meta
				? {
						originalHash: tab.meta.original.hash,
						modifiedHash: tab.meta.modified.hash,
					}
				: null,
		[tab.meta],
	);
	const reviewable = scopeHasMutableModifiedSide(tab.scope);
	const mutationsAvailable = canOfferChangeMutations(
		tab.scope,
		protocolVersion,
		mutationExpect !== null,
	);
	const review = useFileReview(tab.workspaceId, tab.path, "diff", tab.scope);
	const targetRef = useAppStore((state) => selectDiffTabTargetRef(state, tab));
	const agentWorking = useAppStore((state) => selectWorkspaceIsRunning(state, tab.workspaceId));

	const { reload } = useLiveTabContent(
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
	const [placement, setPlacement] = useState<{
		implementationKey: string;
		ids: ReadonlySet<string>;
	} | null>(null);
	const onPlacedThreadIds = useCallback(
		(ids: ReadonlySet<string>) => {
			setPlacement((current) => {
				if (current?.implementationKey === implementationKey && sameIds(current.ids, ids)) {
					return current;
				}
				return { implementationKey, ids: new Set(ids) };
			});
		},
		[implementationKey],
	);
	const placedThreadIds =
		placement?.implementationKey === implementationKey ? placement.ids : undefined;
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
	const modifiedText = modified.kind === "text" ? modified.text : "";
	const { dir, base } = splitPath(tab.path);
	const handleMutationError = useCallback(
		(error: unknown, title: string) => {
			if (wsErrorCode(error) === "STALE_VIEW") {
				reload();
				toast.info("This file changed since you opened it — review the new diff");
				return;
			}
			toast.error(errorText(error), title);
		},
		[reload],
	);
	const undoReceipt = useCallback(
		async (receipt: ChangeReceipt) => {
			try {
				await getTransport().request("change.undo", {
					workspaceId: tab.workspaceId,
					receiptId: receipt.id,
					expect: { modifiedHash: receipt.after.hash },
				});
			} catch (error) {
				handleMutationError(error, "Couldn't undo the revert");
			}
		},
		[handleMutationError, tab.workspaceId],
	);
	const showUndoToast = useCallback(
		(receipt: ChangeReceipt, message: string) => {
			useAppStore.getState().pushToast({
				variant: "success",
				message,
				durationMs: 8000,
				action: {
					label: "Undo",
					onClick: () => {
						void undoReceipt(receipt);
					},
				},
			});
		},
		[undoReceipt],
	);
	const revertBlock = useCallback<HunkActions["revert"]>(
		async (block) => {
			try {
				if (!mutationExpect) throw new Error("Change metadata is not ready");
				const { receipt } = await getTransport().request("change.revert", {
					workspaceId: tab.workspaceId,
					path: tab.path,
					scope: tab.scope,
					target: { kind: "range", original: block.original, modified: block.modified },
					expect: mutationExpect,
				});
				showUndoToast(receipt, `Reverted hunk in ${base}`);
			} catch (error) {
				handleMutationError(error, "Couldn't revert the hunk");
			}
		},
		[
			base,
			handleMutationError,
			mutationExpect,
			showUndoToast,
			tab.path,
			tab.scope,
			tab.workspaceId,
		],
	);
	const revertFile = useCallback(async () => {
		try {
			if (!mutationExpect) throw new Error("Change metadata is not ready");
			const { receipt } = await getTransport().request("change.revert", {
				workspaceId: tab.workspaceId,
				path: tab.path,
				scope: tab.scope,
				target: { kind: "file" },
				expect: mutationExpect,
			});
			showUndoToast(receipt, receipt.trashed ? `Moved ${base} to the trash` : `Reverted ${base}`);
		} catch (error) {
			handleMutationError(error, "Couldn't revert the file");
		}
	}, [
		base,
		handleMutationError,
		mutationExpect,
		showUndoToast,
		tab.path,
		tab.scope,
		tab.workspaceId,
	]);
	const askAgent = useCallback<HunkActions["askAgent"]>(
		(block) => createAskAgentRequest(block, modifiedText),
		[modifiedText],
	);
	const hunkActions = useMemo<HunkActions | undefined>(
		() =>
			mutationsAvailable
				? {
						revert: revertBlock,
						revertFile,
						askAgent,
						agentWorking,
					}
				: undefined,
		[agentWorking, askAgent, mutationsAvailable, revertBlock, revertFile],
	);
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
				{hunkActions ? (
					<HeaderIconButton
						testid="diff-revert-file"
						label="Revert file"
						onClick={() => void hunkActions.revertFile()}
					>
						<Revert className="size-14" />
					</HeaderIconButton>
				) : null}
				{renderer.capabilities.whitespace ? (
					<HeaderIconButton
						testid="diff-toggle-whitespace"
						label="Hide whitespace changes"
						active={ignoreWhitespace}
						onClick={() => setDiffTabIgnoreWhitespace(tab.id, !ignoreWhitespace)}
					>
						<Pilcrow className="size-14" />
					</HeaderIconButton>
				) : null}
				{renderer.capabilities.copy ? (
					<HeaderIconButton
						testid="diff-copy"
						label="Copy file contents"
						onClick={() => void copy()}
					>
						{copied ? (
							<Check className="size-14 text-feedback-success" />
						) : (
							<Copy className="size-14" />
						)}
					</HeaderIconButton>
				) : null}
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
				{renderer.capabilities.layout ? (
					<>
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
					</>
				) : null}
			</div>
			<UnplacedReviewStrip
				reviews={reviews}
				renderer={renderer}
				intent="diff"
				candidates={candidates}
				{...(placedThreadIds ? { placedThreadIds } : {})}
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
						{...(hunkActions ? { hunkActions } : {})}
						onPlacedThreadIds={onPlacedThreadIds}
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
