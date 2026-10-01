import { useEffect, useMemo, useRef } from "react";
import type { ResourceViewProps, ReviewThread } from "@/resources";
import { ReviewComposer } from "../../ReviewComposer";
import { ReviewThreadCard } from "../../ReviewThreadCard";
import { contentStamp, useStampedComposer } from "../reviewComposerState";
import { StaleComposerNotice } from "../StaleComposerNotice";
import { JsonTree, type JsonTreeThread } from "./JsonTree";
import {
	type JsonDialect,
	type JsonNode,
	jsonNodeDraft,
	jsonNodeOfAnchor,
	placedJsonThreadIds,
	scanJson,
} from "./jsonScanner";

const NO_THREADS: ReadonlySet<string> = new Set();

function dialectNotice(path: string, dialect: JsonDialect): string | null {
	if (dialect !== "jsonc") return null;
	return path.toLowerCase().endsWith(".jsonc")
		? null
		: "Parsed as JSONC: this file uses comments or trailing commas, which strict JSON parsers reject.";
}

export default function JsonView({
	resource,
	content,
	review,
	onPlacedThreadIds,
}: ResourceViewProps) {
	const text = content.kind === "text" ? content.text : "";
	const document = useMemo(() => scanJson(text), [text]);
	const composer = useStampedComposer<JsonNode>(contentStamp(content));
	const selected = composer.selection;
	const rootRef = useRef<HTMLDivElement>(null);
	const cardRefs = useRef(new Map<string, HTMLDivElement>());
	const handledFocusRef = useRef<string | null>(null);
	const placed = useMemo(
		() => (document ? placedJsonThreadIds(review?.threads ?? [], document) : NO_THREADS),
		[document, review?.threads],
	);
	const threadsByPointer = useMemo(() => {
		const result = new Map<string, JsonTreeThread[]>();
		if (!document) return result;
		let number = 0;
		for (const thread of review?.threads ?? []) {
			const node = jsonNodeOfAnchor(thread.anchor, document);
			if (!node) continue;
			number += 1;
			const entries = result.get(node.pointer) ?? [];
			entries.push({ thread, number, side: "worktree" });
			result.set(node.pointer, entries);
		}
		return result;
	}, [document, review?.threads]);
	const draft = selected ? jsonNodeDraft(selected) : null;
	const focusId = review?.focus?.id ?? null;

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
		review?.onFocusHandled();
	}, [focusId, placed, review]);

	if (!document) {
		return (
			<div
				data-testid="json-invalid"
				className="h-full overflow-auto bg-container-workspace-bg p-12 tr-text-ui text-text-muted"
			>
				Not valid JSON or JSONC — switch to Source to inspect the file.
			</div>
		);
	}
	const notice = dialectNotice(resource.path, document.dialect);
	const scrollToCard = (id: string) =>
		cardRefs.current.get(id)?.scrollIntoView({ block: "center" });
	const scrollToNode = (thread: ReviewThread) => {
		const node = jsonNodeOfAnchor(thread.anchor, document);
		if (!node) return;
		const element = [
			...(rootRef.current?.querySelectorAll<HTMLElement>("[data-json-pointer]") ?? []),
		].find((candidate) => candidate.dataset.jsonPointer === node.pointer);
		element?.scrollIntoView({ block: "center" });
	};

	return (
		<div
			ref={rootRef}
			data-testid="json-view"
			className="h-full overflow-auto bg-container-workspace-bg p-12"
		>
			{notice ? (
				<div data-testid="json-dialect" className="pb-8 tr-text-metadata text-text-muted">
					{notice}
				</div>
			) : null}
			<JsonTree
				node={document.root}
				threadsFor={(node) => threadsByPointer.get(node.pointer) ?? []}
				onSelect={composer.select}
				onMarker={scrollToCard}
			/>
			<StaleComposerNotice visible={composer.stale} />
			{composer.composing && selected && draft && review ? (
				<ReviewComposer
					draft={draft}
					label={draft.label}
					commenting={review.commenting}
					onClose={composer.close}
					className="review-composer-flow"
				/>
			) : null}
			{review?.threads
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
							actions={review.actions}
							onActivate={() => scrollToNode(thread)}
						/>
					</div>
				))}
		</div>
	);
}
