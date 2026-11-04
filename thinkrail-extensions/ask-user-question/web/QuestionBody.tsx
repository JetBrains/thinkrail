import { RiQuestionnaireLine as MessageCircleQuestion } from "@remixicon/react";
import type {
	AskUserQuestionDiscussReason,
	AskUserQuestionItem,
} from "@thinkrail/pi-ask-user-question/core";
import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { type LiftKey, NoteSlot, OptionRow, OtherRow } from "./controls";
import { DiscussPanel, DiscussToggle } from "./discuss";
import { useTestId } from "./ghost";
import { OptionPreviewPane, PreviewGlyph, previewSource, QuestionPreview } from "./previews";
import {
	choiceKeyAction,
	hasPreview,
	paneOptionIndex,
	type QState,
	splitRecommended,
} from "./state";

export interface QuestionBodyProps {
	question: AskUserQuestionItem;
	state: QState;
	pageKeys: boolean;
	discussAvailable: boolean;
	primaryEnabled: boolean;
	onFocusPrimary: () => boolean;
	onOpenFile?: ((path: string) => void) | undefined;
	onSelect: (label: string, cursor: number) => void;
	onToggleMulti: (label: string, cursor: number) => void;
	onCursor: (cursor: number) => void;
	onCustomText: (text: string) => void;
	onToggleCustom: () => void;
	onReopenCustom: () => void;
	onOpenNote: (label: string, cursor: number) => void;
	onCloseNote: () => void;
	onNote: (label: string, text: string) => void;
	onToggleDiscuss: () => void;
	onDiscussReason: (reason: AskUserQuestionDiscussReason) => void;
	onDiscussText: (text: string) => void;
	onTogglePreview: () => void;
}

const focusOf = (element: HTMLElement | null | undefined) =>
	element?.focus({ preventScroll: true });

export function QuestionBody({
	question,
	state,
	pageKeys,
	discussAvailable,
	primaryEnabled,
	onFocusPrimary,
	onOpenFile,
	onSelect,
	onToggleMulti,
	onCursor,
	onCustomText,
	onToggleCustom,
	onReopenCustom,
	onOpenNote,
	onCloseNote,
	onNote,
	onToggleDiscuss,
	onDiscussReason,
	onDiscussText,
	onTogglePreview,
}: QuestionBodyProps) {
	const tid = useTestId();
	const choiceRefs = useRef<Array<HTMLElement | null>>([]);
	const noteButtonRefs = useRef(new Map<string, HTMLElement>());
	const noteRef = useRef<HTMLElement | null>(null);
	const otherRowRef = useRef<HTMLElement | null>(null);
	const discussRef = useRef<HTMLElement | null>(null);
	const discussPanelRef = useRef<HTMLElement | null>(null);
	const discussToggleRef = useRef<HTMLButtonElement | null>(null);
	const paneScrollRef = useRef<HTMLElement | null>(null);
	const pendingFocus = useRef<(() => HTMLElement | null | undefined) | null>(null);
	const otherIndex = question.options.length;
	const choiceCount = otherIndex + (primaryEnabled ? 2 : 1);
	const cursor = Math.min(Math.max(state.cursor, 0), Math.max(otherIndex - 1, 0));
	const discussing = discussAvailable && state.discuss;
	const customOwnsPageFocus =
		!discussing && state.customActive && (!question.multiSelect || state.multi.length === 0);
	const questionPreview = previewSource(question);
	const paneShown = !question.multiSelect && question.options.some(hasPreview);
	const paneIndex = paneShown ? paneOptionIndex(question, state, state.cursor) : null;
	const paneOption = paneIndex == null ? null : (question.options[paneIndex] ?? null);

	useEffect(() => {
		const resolve = pendingFocus.current;
		if (!resolve) return;
		const element = resolve();
		if (!element) return;
		pendingFocus.current = null;
		focusOf(element);
	});

	const moveTo = (index: number) => {
		if (index > otherIndex) {
			if (onFocusPrimary()) return;
			index = 0;
		}
		onCursor(index);
		focusOf(choiceRefs.current[index]);
	};

	const move = (key: string, from: number) => {
		const action = choiceKeyAction(key, from, choiceCount, otherIndex);
		if (action.type === "move") moveTo(action.index);
	};

	const openNote = (label: string, index: number) => {
		pendingFocus.current = () => noteRef.current;
		onOpenNote(label, index);
	};

	const finishNote = (label: string) => {
		pendingFocus.current = () => noteButtonRefs.current.get(label);
		onCloseNote();
	};

	const openDiscuss = () => {
		pendingFocus.current = () => discussRef.current;
		if (!state.discuss) onToggleDiscuss();
	};

	const toggleDiscuss = () => {
		pendingFocus.current = state.discuss ? null : () => discussRef.current;
		onToggleDiscuss();
	};

	const onChoiceKeyDown = (
		event: KeyboardEvent<HTMLButtonElement>,
		label: string,
		index: number,
	) => {
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		const pane = paneScrollRef.current;
		if (pane && (event.key === "PageDown" || event.key === "PageUp")) {
			event.preventDefault();
			pane.scrollBy({ top: (event.key === "PageDown" ? 0.9 : -0.9) * pane.clientHeight });
			return;
		}
		const action = choiceKeyAction(event.key, index, choiceCount, otherIndex);
		if (action.type === "none" || (action.type === "discuss" && !discussAvailable)) return;
		event.preventDefault();
		if (action.type === "move") moveTo(action.index);
		else if (action.type === "select") {
			if (question.multiSelect) onToggleMulti(label, index);
			else onSelect(label, index);
		} else if (action.type === "note") openNote(label, index);
		else openDiscuss();
	};

	return (
		<div className="flex flex-col gap-12">
			<div className="flex items-start gap-8">
				<MessageCircleQuestion className="mt-2 size-16 shrink-0 text-text-muted" />
				<p
					data-testid={tid("ask-question-text")}
					data-ask-page-start="true"
					className="min-w-0 flex-1 tr-title-dialog text-text-default"
				>
					{question.question}
				</p>
				{discussAvailable ? (
					<DiscussToggle
						active={state.discuss}
						buttonRef={(node) => {
							discussToggleRef.current = node;
						}}
						onToggle={toggleDiscuss}
					/>
				) : null}
			</div>
			{discussing ? (
				<DiscussPanel
					reason={state.discussReason}
					text={state.discussText}
					panelRef={(node) => {
						discussPanelRef.current = node;
					}}
					fieldRef={(node) => {
						discussRef.current = node;
					}}
					onReason={onDiscussReason}
					onText={onDiscussText}
					onDone={() => focusOf(discussPanelRef.current)}
					onReopen={() => focusOf(discussRef.current)}
					onUp={() => focusOf(discussToggleRef.current)}
					onDown={() => moveTo(cursor)}
				/>
			) : null}
			{questionPreview ? (
				<QuestionPreview
					source={questionPreview}
					expanded={state.previewExpanded}
					onToggleExpanded={onTogglePreview}
					onOpenFile={onOpenFile}
				/>
			) : null}
			<div
				data-discussing={discussing || undefined}
				className={cn(
					"grid gap-12",
					paneShown && "@2xl:grid-cols-[2fr_3fr]",
					discussing && "opacity-60",
				)}
			>
				<div className="flex min-w-0 flex-col">
					<div
						{...(question.multiSelect
							? { role: "group", "aria-label": question.question }
							: { role: "radiogroup", "aria-label": question.question })}
						className="flex flex-col"
					>
						{question.options.map((option, index) => {
							const selected = question.multiSelect
								? state.multi.includes(option.label)
								: state.option === option.label;
							const ownsCursor = index === cursor;
							const source = paneShown ? previewSource(option) : null;
							return (
								<div key={option.label} className="flex flex-col">
									<OptionRow
										buttonRef={(node) => {
											choiceRefs.current[index] = node;
										}}
										label={option.label}
										description={option.description}
										recommendedReason={option.recommendedReason}
										selected={selected}
										cursor={ownsCursor}
										pageFocus={ownsCursor && !customOwnsPageFocus && !discussing}
										multi={!!question.multiSelect}
										pageKeys={pageKeys}
										previewKeys={paneShown}
										discussKey={discussAvailable}
										glyph={source ? <PreviewGlyph source={source} /> : null}
										onFocus={() => onCursor(index)}
										onKeyDown={(event) => onChoiceKeyDown(event, option.label, index)}
										onClick={() =>
											question.multiSelect
												? onToggleMulti(option.label, index)
												: onSelect(option.label, index)
										}
									/>
									<NoteSlot
										optionText={splitRecommended(option.label).text}
										selected={selected}
										editing={state.noteFor === option.label}
										note={state.notes[option.label] ?? ""}
										fieldRef={(node) => {
											noteRef.current = node;
										}}
										buttonRef={(node) => {
											if (node) noteButtonRefs.current.set(option.label, node);
											else noteButtonRefs.current.delete(option.label);
										}}
										onOpen={() => openNote(option.label, index)}
										onNote={(text) => onNote(option.label, text)}
										onFinish={() => finishNote(option.label)}
										onArrow={(key: LiftKey) => moveTo(key === "ArrowUp" ? index : index + 1)}
									/>
								</div>
							);
						})}
					</div>

					<OtherRow
						rowRef={(node) => {
							otherRowRef.current = node;
						}}
						fieldRef={(node) => {
							choiceRefs.current[otherIndex] = node;
						}}
						multi={!!question.multiSelect}
						active={state.customActive}
						text={state.customText}
						pageFocus={!discussing && (question.options.length === 0 || customOwnsPageFocus)}
						onFocusField={() => onCursor(otherIndex)}
						onToggle={onToggleCustom}
						onText={onCustomText}
						onMove={(key: LiftKey) => move(key, otherIndex)}
						onDone={() => focusOf(otherRowRef.current)}
						onReopen={() => {
							onReopenCustom();
							focusOf(choiceRefs.current[otherIndex]);
						}}
					/>
				</div>

				{paneShown ? (
					<OptionPreviewPane
						label={paneOption ? splitRecommended(paneOption.label).text : null}
						source={paneOption ? previewSource(paneOption) : null}
						scrollRef={(node) => {
							paneScrollRef.current = node;
						}}
						onOpenFile={onOpenFile}
					/>
				) : null}
			</div>
		</div>
	);
}
