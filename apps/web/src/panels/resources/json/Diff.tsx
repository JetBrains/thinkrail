import { useEffect, useMemo, useRef } from "react";
import type { ResourceDiffProps, ReviewThread, SurfaceReview } from "@/resources";
import { ReviewComposer } from "../../ReviewComposer";
import { ReviewThreadCard } from "../../ReviewThreadCard";
import { diffContentStamp, useStampedComposer } from "../reviewComposerState";
import { StaleComposerNotice } from "../StaleComposerNotice";
import { JsonTree, type JsonTreeThread } from "./JsonTree";
import { classifyJsonDiff, type JsonDiffMark } from "./jsonDiff";
import { buildJsonDiffReviewLayout } from "./jsonDiffReview";
import {
	type JsonNode,
	jsonNodeDraft,
	jsonNodeOfAnchor,
	jsonPrimitiveLabel,
	scanJson,
} from "./jsonScanner";

const NO_THREADS: ReadonlySet<string> = new Set();
type Side = "base" | "worktree";

interface SelectedNode {
	node: JsonNode;
	side: Side;
}

function nodeSummary(node: JsonNode): string {
	if (node.type === "object") return `{${node.children.length}}`;
	if (node.type === "array") return `[${node.children.length}]`;
	return jsonPrimitiveLabel(node.value);
}

export default function JsonDiff({
	original,
	modified,
	review,
	onPlacedThreadIds,
}: ResourceDiffProps) {
	const originalText = original.kind === "text" ? original.text : null;
	const modifiedText = modified.kind === "text" ? modified.text : null;
	const originalDocument = useMemo(
		() => (originalText === null ? null : scanJson(originalText)),
		[originalText],
	);
	const modifiedDocument = useMemo(
		() => (modifiedText === null ? null : scanJson(modifiedText)),
		[modifiedText],
	);
	const classification = useMemo(
		() => classifyJsonDiff(originalDocument?.value, modifiedDocument?.value),
		[modifiedDocument?.value, originalDocument?.value],
	);
	const layout = useMemo(
		() =>
			buildJsonDiffReviewLayout({
				originalPresent: originalText !== null,
				modifiedPresent: modifiedText !== null,
				originalDocument,
				modifiedDocument,
				classification,
				baseThreads: review?.base.threads ?? [],
				worktreeThreads: review?.worktree.threads ?? [],
			}),
		[
			classification,
			modifiedDocument,
			modifiedText,
			originalDocument,
			originalText,
			review?.base.threads,
			review?.worktree.threads,
		],
	);
	const composer = useStampedComposer<SelectedNode>(diffContentStamp(original, modified));
	const selected = composer.selection;
	const rootRef = useRef<HTMLDivElement>(null);
	const cardRefs = useRef(new Map<string, HTMLDivElement>());
	const handledFocusRef = useRef<string | null>(null);
	const placed = layout.placedThreadIds;
	const threadMaps = useMemo(() => {
		const current = new Map<string, JsonTreeThread[]>();
		const removed = new Map<string, JsonTreeThread[]>();
		for (const placement of layout.placements) {
			const target = placement.section === "removed" ? removed : current;
			const entries = target.get(placement.pointer) ?? [];
			entries.push({
				thread: placement.thread,
				number: placement.number,
				side: placement.side,
			});
			target.set(placement.pointer, entries);
		}
		return { current, removed };
	}, [layout.placements]);
	const draft = selected ? jsonNodeDraft(selected.node) : null;
	const focusSurface = review
		? review.worktree.focus
			? review.worktree
			: review.base.focus
				? review.base
				: null
		: null;
	const focusId = focusSurface?.focus?.id ?? null;

	useEffect(() => {
		onPlacedThreadIds?.(placed);
		return () => onPlacedThreadIds?.(NO_THREADS);
	}, [onPlacedThreadIds, placed]);

	useEffect(() => {
		if (!focusId) {
			handledFocusRef.current = null;
			return;
		}
		if (handledFocusRef.current === focusId || !placed.has(focusId)) return;
		const card = cardRefs.current.get(focusId);
		if (!card) return;
		handledFocusRef.current = focusId;
		card.scrollIntoView({ block: "center" });
		focusSurface?.onFocusHandled();
	}, [focusId, focusSurface, placed]);

	if (
		(originalText !== null && !originalDocument) ||
		(modifiedText !== null && !modifiedDocument)
	) {
		return null;
	}
	const surfaceFor = (side: Side): SurfaceReview | undefined =>
		side === "base" ? review?.base : review?.worktree;
	const scrollToCard = (id: string) =>
		cardRefs.current.get(id)?.scrollIntoView({ block: "center" });
	const scrollToThread = (thread: ReviewThread, side: Side) => {
		const document = side === "base" ? originalDocument : modifiedDocument;
		if (!document) return;
		const node = jsonNodeOfAnchor(thread.anchor, document);
		if (!node) return;
		const pointer =
			side === "base"
				? (layout.baseRenderedPointers.get(node.pointer) ?? node.pointer)
				: node.pointer;
		const element = [
			...(rootRef.current?.querySelectorAll<HTMLElement>("[data-json-pointer]") ?? []),
		].find((candidate) => candidate.dataset.jsonPointer === pointer);
		element?.scrollIntoView({ block: "center" });
	};
	const renderValue = (node: JsonNode, mark: JsonDiffMark | undefined) => {
		if (mark?.kind === "changed" && node.type !== "object" && node.type !== "array") {
			return (
				<>
					<span className="text-feedback-error">{jsonPrimitiveLabel(mark.oldValue)}</span>
					<span className="px-4 text-text-subtle">→</span>
					<span className="text-feedback-success">{jsonPrimitiveLabel(node.value)}</span>
				</>
			);
		}
		if (mark?.kind === "moved") {
			return (
				<>
					<span className="mr-4 text-feedback-info">moved</span>
					{nodeSummary(node)}
				</>
			);
		}
		return nodeSummary(node);
	};
	const removedMark = (node: JsonNode): JsonDiffMark => ({
		kind: "removed",
		pointer: node.pointer,
		oldValue: node.value,
	});

	return (
		<div
			ref={rootRef}
			data-testid="json-diff"
			className="h-full overflow-auto bg-container-content-bg p-12"
		>
			{modifiedDocument ? (
				<JsonTree
					node={modifiedDocument.root}
					markFor={(node) => classification.current.get(node.pointer)}
					threadsFor={(node) => threadMaps.current.get(node.pointer) ?? []}
					onSelect={(node) => composer.select({ node, side: "worktree" })}
					onMarker={scrollToCard}
					renderValue={renderValue}
				/>
			) : null}
			{layout.removedNodes.length > 0 ? (
				<section className="mt-12 border-border-default border-t pt-8">
					<h2 className="mb-4 tr-text-eyebrow text-feedback-error">Removed</h2>
					{layout.removedNodes.map((node) => (
						<JsonTree
							key={node.pointer}
							node={node}
							markFor={removedMark}
							threadsFor={(candidate) => threadMaps.removed.get(candidate.pointer) ?? []}
							onSelect={(candidate) => composer.select({ node: candidate, side: "base" })}
							onMarker={scrollToCard}
						/>
					))}
				</section>
			) : null}
			<StaleComposerNotice visible={composer.stale} />
			{composer.composing && selected && draft && surfaceFor(selected.side) ? (
				<ReviewComposer
					draft={draft}
					label={draft.label}
					commenting={(surfaceFor(selected.side) as SurfaceReview).commenting}
					onClose={composer.close}
					className="review-composer-flow"
				/>
			) : null}
			{review
				? (["base", "worktree"] as const).flatMap((side) =>
						review[side].threads
							.filter((thread) => placed.has(thread.id))
							.map((thread) => (
								<div
									key={thread.id}
									ref={(node) => {
										if (node) cardRefs.current.set(thread.id, node);
										else cardRefs.current.delete(thread.id);
									}}
								>
									<ReviewThreadCard
										thread={thread}
										actions={review[side].actions}
										onActivate={() => scrollToThread(thread, side)}
									/>
								</div>
							)),
					)
				: null}
		</div>
	);
}
