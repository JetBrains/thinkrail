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
import { choiceKeyAction, hasPreview, type QState, splitRecommended } from "./state";

export interface QuestionBodyProps {
	question: AskUserQuestionItem;
	state: QState;
	pageKeys: boolean;
	discussAvailable: boolean;
	onOpenFile?: ((path: string) => void) | undefined;
	onSelect: (label: string, cursor: number) => void;
	onToggleMulti: (label: string, cursor: number) => void;
	onCursor: (cursor: number) => void;
	onConfirmChoice: (label: string, cursor: number) => void;
	onCustomText: (text: string) => void;
	onToggleCustom: () => void;
	onConfirmCustom: () => void;
	onOpenNote: (label: string, cursor: number) => void;
	onCloseNote: () => void;
	onNote: (label: string, text: string) => void;
	onToggleDiscuss: () => void;
	onDiscussReason: (reason: AskUserQuestionDiscussReason) => void;
	onDiscussText: (text: string) => void;
	onConfirmDiscuss: () => void;
}

type PendingFocus = "note" | "discuss" | null;

export function QuestionBody({
	question,
	state,
	pageKeys,
	discussAvailable,
	onOpenFile,
	onSelect,
	onToggleMulti,
	onCursor,
	onConfirmChoice,
	onCustomText,
	onToggleCustom,
	onConfirmCustom,
	onOpenNote,
	onCloseNote,
	onNote,
	onToggleDiscuss,
	onDiscussReason,
	onDiscussText,
	onConfirmDiscuss,
}: QuestionBodyProps) {
	const tid = useTestId();
	const choiceRefs = useRef<Array<HTMLElement | null>>([]);
	const noteRef = useRef<HTMLElement | null>(null);
	const discussRef = useRef<HTMLElement | null>(null);
	const discussToggleRef = useRef<HTMLButtonElement | null>(null);
	const pendingFocus = useRef<PendingFocus>(null);
	const otherIndex = question.options.length;
	const choiceCount = otherIndex + 1;
	const cursor = Math.min(Math.max(state.cursor, 0), Math.max(otherIndex - 1, 0));
	const discussing = discussAvailable && state.discuss;
	const customOwnsPageFocus =
		!discussing && state.customActive && (!question.multiSelect || state.multi.length === 0);
	const questionPreview = previewSource(question);
	const paneShown = !question.multiSelect && question.options.some(hasPreview);
	const paneOption = !paneShown
		? null
		: state.customActive
			? null
			: (question.options.find((option) => option.label === state.option) ??
				question.options[cursor] ??
				null);

	useEffect(() => {
		const target = pendingFocus.current;
		if (!target) return;
		const element = target === "note" ? noteRef.current : discussRef.current;
		if (!element) return;
		pendingFocus.current = null;
		element.focus({ preventScroll: true });
	});

	const openNote = (label: string, index: number) => {
		pendingFocus.current = "note";
		onOpenNote(label, index);
	};

	const toggleDiscuss = () => {
		pendingFocus.current = state.discuss ? null : "discuss";
		onToggleDiscuss();
	};

	const focusChoice = (index: number) => {
		if (index < otherIndex) onCursor(index);
		choiceRefs.current[index]?.focus({ preventScroll: true });
	};

	const moveCursor = (index: number) => {
		focusChoice(index);
		const target = question.options[index];
		if (!question.multiSelect && target) onSelect(target.label, index);
	};

	const finishNote = (index: number) => {
		onCloseNote();
		requestAnimationFrame(() => choiceRefs.current[index]?.focus({ preventScroll: true }));
	};

	const onChoiceKeyDown = (
		event: KeyboardEvent<HTMLButtonElement>,
		label: string,
		index: number,
	) => {
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		const action = choiceKeyAction(event.key, index, choiceCount);
		if (action.type === "none") return;
		event.preventDefault();
		if (action.type === "move") moveCursor(action.index);
		else if (action.type === "select") {
			if (question.multiSelect) onToggleMulti(label, index);
			else onSelect(label, index);
		} else if (action.type === "confirm") onConfirmChoice(label, index);
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
					fieldRef={(node) => {
						discussRef.current = node;
					}}
					onReason={onDiscussReason}
					onText={onDiscussText}
					onConfirm={onConfirmDiscuss}
					onLeave={() => discussToggleRef.current?.focus({ preventScroll: true })}
				/>
			) : null}
			{questionPreview ? (
				<QuestionPreview source={questionPreview} onOpenFile={onOpenFile} />
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
										onOpen={() => openNote(option.label, index)}
										onNote={(text) => onNote(option.label, text)}
										onFinish={() => finishNote(index)}
									/>
								</div>
							);
						})}
					</div>

					<OtherRow
						fieldRef={(node) => {
							choiceRefs.current[otherIndex] = node;
						}}
						multi={!!question.multiSelect}
						active={state.customActive}
						text={state.customText}
						pageFocus={!discussing && (question.options.length === 0 || customOwnsPageFocus)}
						onToggle={onToggleCustom}
						onText={onCustomText}
						onMove={(key: LiftKey) => {
							const action = choiceKeyAction(key, otherIndex, choiceCount);
							if (action.type === "move") moveCursor(action.index);
						}}
						onConfirm={onConfirmCustom}
					/>
				</div>

				{paneShown ? (
					<OptionPreviewPane
						label={paneOption ? splitRecommended(paneOption.label).text : null}
						source={paneOption ? previewSource(paneOption) : null}
						onOpenFile={onOpenFile}
					/>
				) : null}
			</div>
		</div>
	);
}
