import { RiQuestionnaireLine as MessageCircleQuestion } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import type { AskUserQuestionItem } from "@thinkrail/pi-ask-user-question/core";
import { useOptionalResourceHost } from "@thinkrail/resource-renderers";
import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { type LiftKey, NoteSlot, OptionRow, OtherRow } from "./controls";
import { useTestId } from "./ghost";
import { choiceKeyAction, type QState, splitRecommended } from "./state";

export interface QuestionBodyProps {
	question: AskUserQuestionItem;
	state: QState;
	pageKeys: boolean;
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
}

export function QuestionBody({
	question,
	state,
	pageKeys,
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
}: QuestionBodyProps) {
	const t = useT();
	const tid = useTestId();
	const choiceRefs = useRef<Array<HTMLElement | null>>([]);
	const noteRef = useRef<HTMLTextAreaElement | null>(null);
	const focusNoteAfterRender = useRef(false);
	const otherIndex = question.options.length;
	const choiceCount = otherIndex + 1;
	const cursor = Math.min(Math.max(state.cursor, 0), Math.max(otherIndex - 1, 0));
	const customOwnsPageFocus =
		state.customActive && (!question.multiSelect || state.multi.length === 0);
	const anyPreview = !question.multiSelect && question.options.some((option) => option.preview);
	const previewSource =
		question.options.find((option) => option.label === state.option && option.preview) ??
		question.options.find((option) => option.preview);

	useEffect(() => {
		if (!focusNoteAfterRender.current || !noteRef.current) return;
		focusNoteAfterRender.current = false;
		noteRef.current.focus({ preventScroll: true });
	});

	const openNote = (label: string, index: number) => {
		focusNoteAfterRender.current = true;
		onOpenNote(label, index);
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
					className="tr-title-dialog text-text-default"
				>
					{question.question}
				</p>
			</div>
			<div className={cn("grid gap-8", anyPreview && "md:grid-cols-2")}>
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
										pageFocus={ownsCursor && !customOwnsPageFocus}
										multi={!!question.multiSelect}
										pageKeys={pageKeys}
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
						pageFocus={question.options.length === 0 || customOwnsPageFocus}
						onToggle={onToggleCustom}
						onText={onCustomText}
						onMove={(key: LiftKey) => {
							const action = choiceKeyAction(key, otherIndex, choiceCount);
							if (action.type === "move") moveCursor(action.index);
						}}
						onConfirm={onConfirmCustom}
					/>
				</div>

				{anyPreview && previewSource?.preview ? (
					<div
						data-testid={tid("ask-preview")}
						className="min-w-0 overflow-auto rounded-sm border border-border-default bg-control-bg px-8 py-4 tr-text-metadata"
					>
						<div className="mb-4 text-text-muted tr-text-metadata">
							{t("tools.ask.preview", { label: previewSource.label })}
						</div>
						<PreviewMarkdown text={previewSource.preview} />
					</div>
				) : null}
			</div>
		</div>
	);
}

function PreviewMarkdown({ text }: { text: string }) {
	const Markdown = useOptionalResourceHost()?.markdown;
	if (Markdown) return <Markdown text={text} />;
	return <pre className="whitespace-pre-wrap tr-text-metadata text-text-default">{text}</pre>;
}
