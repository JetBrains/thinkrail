import type { ChangeReceipt, GitDiffScope, ResourceMeta } from "@thinkrail/contracts";
import {
	createAskAgentRequest,
	describeResource,
	ExpensiveDiffNotice,
	type HunkActions,
	type HunkTriage,
	isDiffTooExpensive,
	RendererDiff,
	type ResourceContent,
	type ResourceDescriptor,
	type ResourceRenderer,
	rendererImplementationKey,
	resolveRenderers,
	selectResourceRenderer,
	surfaceLineCount,
	UnplacedReviewStrip,
	usePlacedThreadIds,
	VIRTUALIZED_DIFF_LINES,
} from "@thinkrail/resource-renderers";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { Suspense, useCallback, useMemo, useState } from "react";
import { usePhoneViewport } from "@/lib";
import { selectWorkspaceIsRunning, toast, useAppStore } from "../store";
import { errorText, getTransport, wsErrorCode } from "../transport";
import { canOfferChangeMutations, scopeHasMutableModifiedSide } from "./changeMutationAvailability";
import { splitPath } from "./changesModel";
import { openFileInTab } from "./openTabs";
import { PENDING_TEXT_META, resourceBytesUrl } from "./resourcePane";
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
	return receipt.trashed ? `Moved ${base} to the trash` : `Reverted ${base}`;
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

function descriptorMetaFor(meta: DiffSurfaceContent["meta"]): ResourceMeta {
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

export function useDiffSurface({
	workspaceId,
	path,
	scope,
	content,
	rendererId,
	reload,
	triage,
}: DiffSurfaceInput): DiffSurface {
	const mobile = usePhoneViewport();
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
	const descriptorMeta = useMemo(() => descriptorMetaFor(content.meta), [content.meta]);
	const resource = useMemo(
		() => describeResource(workspaceId, path, descriptorMeta, scope),
		[workspaceId, path, descriptorMeta, scope],
	);
	const candidates = useMemo(
		() => resolveRenderers(resource, "diff", { mobile }),
		[resource, mobile],
	);
	const renderer = selectResourceRenderer(candidates, rendererId, path);
	const implementationKey = rendererImplementationKey(renderer.id, mobile);
	const { placedThreadIds, onPlacedThreadIds } = usePlacedThreadIds(implementationKey);

	const original = useMemo(
		() =>
			sideContent(
				content.original,
				content.meta?.original,
				content.originalOid ? resourceBytesUrl(workspaceId, path, content.originalOid) : null,
			),
		[content.original, content.meta?.original, content.originalOid, workspaceId, path],
	);
	const modifiedOid =
		scope.kind === "commit" ? scope.sha : scope.kind === "turn" ? scope.headTree : null;
	const modified = useMemo(
		() =>
			sideContent(
				content.modified,
				content.meta?.modified,
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
				toast.info("This file changed since you opened it — review the new diff");
				return;
			}
			if (code === "RECEIPT_UNKNOWN") {
				reload();
				toast.info("This change can no longer be undone — the host no longer holds it");
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
				handleMutationError(error, "Couldn't undo the revert");
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
			if (!mutationExpect) {
				handleMutationError(new Error("Change metadata is not ready"), "Couldn't revert the hunk");
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
				showUndoToast(receipt, `Reverted hunk in ${base}`);
			} catch (error) {
				handleMutationError(error, "Couldn't revert the hunk");
			}
		},
		[base, handleMutationError, mutationExpect, showUndoToast, path, scope, workspaceId],
	);
	const revertFile = useCallback(async () => {
		if (!mutationExpect) {
			handleMutationError(new Error("Change metadata is not ready"), "Couldn't revert the file");
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
			handleMutationError(error, "Couldn't revert the file");
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
	const { renderer, candidates, review, reviewable, hunkActions, placedThreadIds } = surface;
	const reviews = reviewable ? [review.worktree, review.base] : [];
	const tooExpensive = useMemo(
		() => isDiffTooExpensive(surface.original, surface.modified),
		[surface.original, surface.modified],
	);
	const [showLargeDiff, setShowLargeDiff] = useState(false);
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
				{tooExpensive && !showLargeDiff ? (
					<ExpensiveDiffNotice
						onShowAnyway={() => setShowLargeDiff(true)}
						actions={
							surface.modified.kind === "text" && reviewable ? (
								<Button
									size="sm"
									variant="ghost"
									data-testid="diff-open-file"
									onClick={() => void openFileInTab(workspaceId, path, "keep")}
								>
									Open file
								</Button>
							) : null
						}
					/>
				) : (
					<Suspense fallback={loading}>
						<RendererDiff
							key={surface.implementationKey}
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
							virtualize={surface.lineCount > VIRTUALIZED_DIFF_LINES}
						/>
					</Suspense>
				)}
			</div>
		</>
	);
}
