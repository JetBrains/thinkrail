import type { ChangeReceipt, GitDiffScope, ResourceMeta } from "@thinkrail/contracts";
import { i18n, useT } from "@thinkrail/locales/react";
import {
	createAskAgentRequest,
	describeResource,
	diffResourceMeta,
	GuardedRendererDiff,
	type HunkActions,
	type HunkTriage,
	PENDING_TEXT_META,
	type ResourceContent,
	type ResourceDescriptor,
	type ResourceRenderer,
	resourceContent,
	surfaceLineCount,
	UnplacedReviewStrip,
	useRendererSelection,
} from "@thinkrail/resource-renderers";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { Suspense, useCallback, useMemo } from "react";
import { selectWorkspaceIsRunning, toast, useAppStore } from "../store";
import { errorText, getTransport, wsErrorCode } from "../transport";
import { canOfferChangeMutations, scopeHasMutableModifiedSide } from "./changeMutationAvailability";
import { splitPath } from "./changesModel";
import { openFileInTab } from "./openTabs";
import { resourceBytesUrl } from "./resourcePane";
import { type FileReview, useFileReview } from "./useReviewCommenting";

const loading = <LoadingRegion rows={12} className="h-full p-12" />;

export interface DiffSurfaceContent {
	original: string;
	modified: string;
	meta: { original: ResourceMeta; modified: ResourceMeta } | undefined;
	originalOid: string | null | undefined;
}

export interface DiffSurfaceInput {
	workspaceId: string;
	path: string;
	scope: GitDiffScope;
	content: DiffSurfaceContent;
	rendererId: string | undefined;
	reload: () => void;
	triage?: HunkTriage;
}

function fileRevertMessage(receipt: ChangeReceipt, base: string): string {
	return receipt.trashed
		? i18n.t("panels.diffSurface.movedToTrash", { file: base })
		: i18n.t("panels.diffSurface.revertedFile", { file: base });
}

export interface DiffSurface {
	resource: ResourceDescriptor;
	candidates: readonly ResourceRenderer[];
	renderer: ResourceRenderer;
	implementationKey: string;
	mobile: boolean;
	original: ResourceContent;
	modified: ResourceContent;
	lineCount: number;
	review: FileReview;
	reviewable: boolean;
	hunkActions: HunkActions | undefined;
	placedThreadIds: ReadonlySet<string> | undefined;
	onPlacedThreadIds: (ids: ReadonlySet<string>) => void;
}

export function useDiffSurface({
	workspaceId,
	path,
	scope,
	content,
	rendererId,
	reload,
	triage,
}: DiffSurfaceInput): DiffSurface {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const agentWorking = useAppStore((state) => selectWorkspaceIsRunning(state, workspaceId));
	const review = useFileReview(workspaceId, path, "diff", scope);
	const mutationExpect = useMemo(
		() =>
			content.meta
				? { originalHash: content.meta.original.hash, modifiedHash: content.meta.modified.hash }
				: null,
		[content.meta],
	);
	const reviewable = scopeHasMutableModifiedSide(scope);
	const mutationsAvailable = canOfferChangeMutations(
		scope,
		protocolVersion,
		mutationExpect !== null,
	);
	const descriptorMeta = useMemo(
		() =>
			content.meta
				? diffResourceMeta(content.meta.original, content.meta.modified)
				: PENDING_TEXT_META,
		[content.meta],
	);
	const resource = useMemo(
		() => describeResource(workspaceId, path, descriptorMeta, scope),
		[workspaceId, path, descriptorMeta, scope],
	);
	const { mobile, candidates, renderer, implementationKey, placedThreadIds, onPlacedThreadIds } =
		useRendererSelection(resource, "diff", rendererId);

	const original = useMemo(
		() =>
			resourceContent(content.original, content.meta?.original, () =>
				content.originalOid ? resourceBytesUrl(workspaceId, path, content.originalOid) : null,
			),
		[content.original, content.meta?.original, content.originalOid, workspaceId, path],
	);
	const modifiedOid =
		scope.kind === "commit" ? scope.sha : scope.kind === "turn" ? scope.headTree : null;
	const modified = useMemo(
		() =>
			resourceContent(content.modified, content.meta?.modified, () =>
				resourceBytesUrl(workspaceId, path, modifiedOid),
			),
		[content.modified, content.meta?.modified, modifiedOid, workspaceId, path],
	);
	const modifiedText = modified.kind === "text" ? modified.text : "";
	const { base } = splitPath(path);

	const handleMutationError = useCallback(
		(error: unknown, title: string) => {
			const code = wsErrorCode(error);
			if (code === "STALE_VIEW") {
				reload();
				toast.info(i18n.t("panels.diffSurface.staleView"));
				return;
			}
			if (code === "RECEIPT_UNKNOWN") {
				reload();
				toast.info(i18n.t("panels.diffSurface.receiptUnknown"));
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
					workspaceId,
					receiptId: receipt.id,
					expect: { modifiedHash: receipt.after.hash },
				});
			} catch (error) {
				handleMutationError(error, i18n.t("panels.diffSurface.undoFailed"));
			}
		},
		[handleMutationError, workspaceId],
	);
	const showUndoToast = useCallback(
		(receipt: ChangeReceipt, message: string) => {
			useAppStore.getState().pushToast({
				variant: "success",
				message,
				durationMs: 8000,
				action: {
					label: i18n.t("panels.diffSurface.undo"),
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
			if (!mutationExpect) {
				handleMutationError(
					new Error(i18n.t("panels.diffSurface.metadataNotReady")),
					i18n.t("panels.diffSurface.revertHunkFailed"),
				);
				return;
			}
			try {
				const { receipt } = await getTransport().request("change.revert", {
					workspaceId,
					path,
					scope,
					target: { kind: "range", original: block.original, modified: block.modified },
					expect: mutationExpect,
				});
				showUndoToast(receipt, i18n.t("panels.diffSurface.revertedHunk", { file: base }));
			} catch (error) {
				handleMutationError(error, i18n.t("panels.diffSurface.revertHunkFailed"));
			}
		},
		[base, handleMutationError, mutationExpect, showUndoToast, path, scope, workspaceId],
	);
	const revertFile = useCallback(async () => {
		if (!mutationExpect) {
			handleMutationError(
				new Error(i18n.t("panels.diffSurface.metadataNotReady")),
				i18n.t("panels.diffSurface.revertFileFailed"),
			);
			return;
		}
		try {
			const { receipt } = await getTransport().request("change.revert", {
				workspaceId,
				path,
				scope,
				target: { kind: "file" },
				expect: mutationExpect,
			});
			showUndoToast(receipt, fileRevertMessage(receipt, base));
		} catch (error) {
			handleMutationError(error, i18n.t("panels.diffSurface.revertFileFailed"));
		}
	}, [base, handleMutationError, mutationExpect, showUndoToast, path, scope, workspaceId]);
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
						...(triage ? { triage } : {}),
					}
				: undefined,
		[agentWorking, askAgent, mutationsAvailable, revertBlock, revertFile, triage],
	);

	const lineCount = useMemo(() => surfaceLineCount(original, modified), [original, modified]);

	return {
		resource,
		candidates,
		renderer,
		implementationKey,
		mobile,
		original,
		modified,
		lineCount,
		review,
		reviewable,
		hunkActions,
		placedThreadIds,
		onPlacedThreadIds,
	};
}

export function DiffSurfaceBody({
	surface,
	view,
	ignoreWhitespace,
	viewState,
	onViewState,
	onSelectRenderer,
	bodyClassName = "min-h-0 flex-1",
}: {
	surface: DiffSurface;
	view: "split" | "inline";
	ignoreWhitespace: boolean;
	viewState: unknown;
	onViewState?: ((state: unknown) => void) | undefined;
	onSelectRenderer: (rendererId: string) => void;
	bodyClassName?: string;
}) {
	const t = useT();
	const { renderer, candidates, review, reviewable, hunkActions, placedThreadIds } = surface;
	const reviews = reviewable ? [review.worktree, review.base] : [];
	const { workspaceId, path } = surface.resource;
	return (
		<>
			<UnplacedReviewStrip
				reviews={reviews}
				renderer={renderer}
				intent="diff"
				candidates={candidates}
				{...(placedThreadIds ? { placedThreadIds } : {})}
				onSelectRenderer={onSelectRenderer}
			/>
			<div className={bodyClassName}>
				<Suspense fallback={loading}>
					<GuardedRendererDiff
						renderer={renderer}
						implementationKey={surface.implementationKey}
						resource={surface.resource}
						original={surface.original}
						modified={surface.modified}
						layout={view === "split" ? "split" : "unified"}
						ignoreWhitespace={ignoreWhitespace}
						{...(reviewable ? { review } : {})}
						{...(hunkActions ? { hunkActions } : {})}
						onPlacedThreadIds={surface.onPlacedThreadIds}
						viewState={viewState}
						{...(onViewState ? { onViewState } : {})}
						lineCount={surface.lineCount}
						noticeActions={
							surface.modified.kind === "text" && reviewable ? (
								<Button
									size="m"
									variant="ghost"
									data-testid="diff-open-file"
									onClick={() => void openFileInTab(workspaceId, path, "keep")}
								>
									{t("panels.diffSurface.openFile")}
								</Button>
							) : null
						}
					/>
				</Suspense>
			</div>
		</>
	);
}
