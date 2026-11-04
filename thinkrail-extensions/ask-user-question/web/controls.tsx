import {
	RiChat3Line as ChatLine,
	RiCheckLine as Check,
	RiRecordCircleLine as CircleDot,
	RiEditLine as EditLine,
	RiListCheck3 as ListChecks,
	RiPencilLine as Pencil,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { isApplePlatform, isImeComposing } from "@thinkrail/ui/keyboard";
import { cn } from "@thinkrail/ui/utils";
import type { KeyboardEvent, ReactNode } from "react";
import { useId } from "react";
import { AutosizeField } from "./AutosizeField";
import { useTestId } from "./ghost";
import { fieldKeyAction, readRecommendation } from "./state";

export type LiftKey = "ArrowUp" | "ArrowDown";

export function liftOutKey(event: KeyboardEvent<HTMLTextAreaElement>): LiftKey | null {
	if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return null;
	if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return null;
	if (isImeComposing(event.nativeEvent)) return null;
	return event.key;
}

export function liftWhenCaretStays(
	field: HTMLTextAreaElement,
	key: LiftKey,
	onLift: (key: LiftKey) => void,
): void {
	const start = field.selectionStart;
	const end = field.selectionEnd;
	requestAnimationFrame(() => {
		if (document.activeElement !== field) return;
		if (field.selectionStart === start && field.selectionEnd === end) onLift(key);
	});
}

export function Indicator({
	selected,
	multi,
	className,
}: {
	selected: boolean;
	multi: boolean;
	className?: string;
}) {
	if (multi) {
		return (
			<span
				className={cn(
					"mt-2 flex size-[18px] shrink-0 items-center justify-center rounded-sm border",
					selected ? "border-primary bg-primary text-text-on-primary" : "border-border-default",
					className,
				)}
			>
				{selected ? <Check className="size-12" /> : null}
			</span>
		);
	}
	return (
		<span
			className={cn(
				"mt-2 flex size-[18px] shrink-0 items-center justify-center rounded-full border",
				selected ? "border-primary" : "border-border-default",
				className,
			)}
		>
			{selected ? <span className="size-8 rounded-full bg-primary" /> : null}
		</span>
	);
}

const RECOMMENDED_PILL =
	"inline-flex items-center rounded-full bg-primary-subtle px-4 py-0 tr-text-label-pill text-primary";

function RecommendedBadge() {
	const t = useT();
	return <span className={RECOMMENDED_PILL}>{t("tools.ask.recommended")}</span>;
}

export function TabChip({
	id,
	controls,
	label,
	active,
	answered,
	discuss,
	onClick,
}: {
	id: string;
	controls: string;
	label: string;
	active: boolean;
	answered: boolean;
	discuss: boolean;
	onClick: () => void;
}) {
	const t = useT();
	return (
		<button
			type="button"
			role="tab"
			id={id}
			aria-controls={controls}
			aria-selected={active}
			tabIndex={active ? 0 : -1}
			data-testid="ask-tab"
			data-active={active}
			data-answered={answered}
			data-discuss={discuss}
			onClick={onClick}
			className={cn(
				"flex shrink-0 items-center gap-4 whitespace-nowrap rounded-full px-8 py-2 tr-text-metadata outline-none focus-visible:ring-2 focus-visible:ring-primary",
				active ? "bg-primary-subtle text-primary" : "text-text-muted hover:bg-control-bg-hovered",
			)}
		>
			<span
				className={cn(
					"flex size-14 items-center justify-center rounded-full border",
					discuss
						? "border-feedback-info text-feedback-info"
						: answered
							? "border-primary text-primary"
							: "border-border-default",
				)}
			>
				{discuss ? (
					<ChatLine aria-hidden="true" className="size-10" />
				) : answered ? (
					<Check aria-hidden="true" className="size-10" />
				) : null}
			</span>
			{label}
			{discuss ? <span className="sr-only">{t("tools.ask.discussMarked")}</span> : null}
		</button>
	);
}

export function ModeHint({
	multiSelect,
	multipleQuestions,
	previewKeys,
	discussKey,
}: {
	multiSelect: boolean;
	multipleQuestions: boolean;
	previewKeys: boolean;
	discussKey: boolean;
}) {
	const t = useT();
	return (
		<span
			data-testid="ask-shortcuts"
			className="flex flex-wrap items-center gap-4 text-text-muted tr-text-metadata"
		>
			{multiSelect ? (
				<ListChecks className="size-14 shrink-0" />
			) : (
				<CircleDot className="size-14 shrink-0" />
			)}
			<span>{t("tools.ask.hintMove")}</span>
			<span>{multiSelect ? t("tools.ask.hintEnterToggle") : t("tools.ask.hintEnterSelect")}</span>
			<span>{t("tools.ask.hintSpaceNote")}</span>
			{discussKey ? <span>{t("tools.ask.hintDiscussKey")}</span> : null}
			<span>
				{isApplePlatform() ? t("tools.ask.hintSubmitApple") : t("tools.ask.hintSubmitOther")}
			</span>
			{multipleQuestions ? <span>{t("tools.ask.hintQuestions")}</span> : null}
			{previewKeys ? <span>{t("tools.ask.hintPreviewScroll")}</span> : null}
			<span>{t("tools.ask.hintSkip")}</span>
		</span>
	);
}

export function OptionRow({
	buttonRef,
	label,
	description,
	recommendedReason,
	selected,
	cursor,
	pageFocus,
	multi,
	pageKeys,
	previewKeys,
	discussKey,
	glyph,
	onFocus,
	onKeyDown,
	onClick,
}: {
	buttonRef: (node: HTMLButtonElement | null) => void;
	label: string;
	description: string;
	recommendedReason?: string | undefined;
	selected: boolean;
	cursor: boolean;
	pageFocus: boolean;
	multi: boolean;
	pageKeys: boolean;
	previewKeys: boolean;
	discussKey: boolean;
	glyph?: ReactNode;
	onFocus: () => void;
	onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
	onClick: () => void;
}) {
	const t = useT();
	const tid = useTestId();
	const { text, recommended, reason } = readRecommendation({ label, recommendedReason });
	return (
		<button
			ref={buttonRef}
			type="button"
			{...(multi
				? { role: "checkbox", "aria-checked": selected }
				: { role: "radio", "aria-checked": selected })}
			aria-keyshortcuts={`ArrowUp ArrowDown Home End Enter Space${discussKey ? " D" : ""}${pageKeys ? " ArrowLeft ArrowRight" : ""}${previewKeys ? " PageUp PageDown" : ""} Meta+Enter Control+Enter Shift+Escape`}
			tabIndex={cursor ? 0 : -1}
			data-testid={tid("ask-option")}
			data-ask-option=""
			data-selected={selected}
			data-cursor={cursor}
			data-ask-page-focus={pageFocus || undefined}
			onFocus={onFocus}
			onKeyDown={onKeyDown}
			onClick={(event) => {
				event.currentTarget.focus({ preventScroll: true });
				onClick();
			}}
			className={cn(
				"flex items-start gap-8 rounded-sm border px-12 py-8 text-left outline-none transition-colors focus-visible:border-control-border-active focus-visible:ring-2 focus-visible:ring-primary",
				selected
					? "border-primary bg-primary-subtle"
					: "border-border-default hover:bg-control-bg-hovered",
			)}
		>
			<Indicator selected={selected} multi={multi} />
			<span className="flex min-w-0 flex-1 flex-col gap-2">
				<span className="flex items-center gap-4">
					<span data-testid={tid("ask-option-label")} className="tr-text-ui text-text-default">
						{text}
					</span>
					{recommended ? <RecommendedBadge /> : null}
					{glyph ? <span className="ml-auto flex shrink-0 text-text-subtle">{glyph}</span> : null}
				</span>
				{description ? (
					<span className="text-text-muted tr-text-metadata">{description}</span>
				) : null}
				{reason ? (
					<span
						data-testid={tid("ask-recommended-reason")}
						className="mt-2 text-text-muted tr-text-metadata"
					>
						<span className="tr-text-emphasis text-primary">{t("tools.ask.why")}</span> {reason}
					</span>
				) : null}
			</span>
		</button>
	);
}

export function NoteSlot({
	optionText,
	selected,
	editing,
	note,
	fieldRef,
	buttonRef,
	onOpen,
	onNote,
	onFinish,
	onArrow,
}: {
	optionText: string;
	selected: boolean;
	editing: boolean;
	note: string;
	fieldRef: (node: HTMLTextAreaElement | null) => void;
	buttonRef: (node: HTMLButtonElement | null) => void;
	onOpen: () => void;
	onNote: (text: string) => void;
	onFinish: () => void;
	onArrow: (key: LiftKey) => void;
}) {
	const t = useT();
	const tid = useTestId();
	const noteId = useId();
	const saved = note.trim();
	const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
		if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
		event.preventDefault();
		onArrow(event.key);
	};
	return (
		<div
			className={cn("flex min-h-24 flex-col px-12 pt-2", selected && (editing || saved) && "pb-8")}
		>
			<div className="flex pl-[calc(1.125rem+var(--space-8))]">
				{!selected ? null : editing ? (
					<AutosizeField
						fieldRef={fieldRef}
						tabIndex={0}
						data-testid={tid("ask-note")}
						aria-label={t("tools.ask.noteLabel", { option: optionText })}
						aria-keyshortcuts="Enter Shift+Enter Escape"
						value={note}
						placeholder={t("tools.ask.notePlaceholder")}
						onChange={(event) => onNote(event.target.value)}
						onKeyDown={(event) => {
							const lift = liftOutKey(event);
							if (lift) {
								liftWhenCaretStays(event.currentTarget, lift, onFinish);
								return;
							}
							const action = fieldKeyAction(event, isImeComposing(event.nativeEvent));
							if (action === "none") return;
							event.stopPropagation();
							if (action === "consume") return;
							event.preventDefault();
							onFinish();
						}}
						className="border-control-border-active"
					/>
				) : saved ? (
					<button
						ref={buttonRef}
						type="button"
						tabIndex={0}
						data-testid={tid("ask-note-toggle")}
						aria-label={t("tools.ask.editNoteLabel", { option: optionText })}
						aria-describedby={noteId}
						onClick={onOpen}
						onKeyDown={onButtonKeyDown}
						className="flex min-w-0 flex-1 items-start gap-4 rounded-sm px-4 py-2 text-left outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary"
					>
						<Pencil aria-hidden="true" className="mt-2 size-14 shrink-0 text-text-muted" />
						<span
							id={noteId}
							data-testid={tid("ask-note-text")}
							className="min-w-0 flex-1 whitespace-pre-wrap break-words tr-text-ui text-text-default"
						>
							{note}
						</span>
					</button>
				) : (
					<Button
						ref={buttonRef}
						variant="ghost"
						size="s"
						iconLeft={Pencil}
						tabIndex={0}
						data-testid={tid("ask-note-toggle")}
						aria-label={t("tools.ask.addNoteLabel", { option: optionText })}
						onClick={onOpen}
						onKeyDown={onButtonKeyDown}
					>
						{t("tools.ask.addNote")}
					</Button>
				)}
			</div>
		</div>
	);
}

export function OtherRow({
	rowRef,
	fieldRef,
	multi,
	active,
	text,
	pageFocus,
	onFocusField,
	onToggle,
	onText,
	onMove,
	onDone,
	onReopen,
}: {
	rowRef: (node: HTMLLabelElement | null) => void;
	fieldRef: (node: HTMLTextAreaElement | null) => void;
	multi: boolean;
	active: boolean;
	text: string;
	pageFocus: boolean;
	onFocusField: () => void;
	onToggle: () => void;
	onText: (text: string) => void;
	onMove: (key: LiftKey) => void;
	onDone: () => void;
	onReopen: () => void;
}) {
	const t = useT();
	const tid = useTestId();
	const inputId = useId();
	return (
		<label
			ref={rowRef}
			htmlFor={inputId}
			tabIndex={-1}
			data-testid={tid("ask-custom-row")}
			data-ask-custom-row=""
			data-selected={active}
			onKeyDown={(event) => {
				if (event.target !== event.currentTarget) return;
				if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
				if (event.key === "ArrowUp" || event.key === "ArrowDown") {
					event.preventDefault();
					onMove(event.key);
				} else if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onReopen();
				}
			}}
			className={cn(
				"flex cursor-text items-start gap-8 rounded-sm border px-12 py-8 outline-none transition-colors focus-within:border-control-border-active focus-within:ring-2 focus-within:ring-primary",
				active
					? "border-primary bg-primary-subtle"
					: "border-border-default hover:bg-control-bg-hovered",
			)}
		>
			{multi ? (
				<button
					type="button"
					tabIndex={0}
					data-testid={tid("ask-custom-toggle")}
					aria-label={active ? t("tools.ask.excludeCustom") : t("tools.ask.includeCustom")}
					onClick={(event) => {
						event.preventDefault();
						onToggle();
					}}
					className="flex items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
				>
					<Indicator selected={active} multi />
				</button>
			) : (
				<Indicator selected={active} multi={false} />
			)}
			<span className="flex min-w-0 flex-1 flex-col gap-4">
				<span className="flex items-center gap-4 tr-text-ui text-text-default">
					<EditLine aria-hidden="true" className="size-14 shrink-0 text-text-muted" />
					{t("tools.ask.otherTitle")}
				</span>
				<AutosizeField
					id={inputId}
					fieldRef={fieldRef}
					tabIndex={0}
					data-testid={tid("ask-custom")}
					data-ask-page-focus={pageFocus || undefined}
					aria-label={t("tools.ask.otherLabel")}
					aria-keyshortcuts="ArrowUp ArrowDown Enter Escape Shift+Enter Meta+Enter Control+Enter Shift+Escape"
					value={text}
					placeholder={t("tools.ask.otherPlaceholder")}
					onFocus={onFocusField}
					onChange={(event) => onText(event.target.value)}
					onKeyDown={(event) => {
						const lift = liftOutKey(event);
						if (lift) {
							liftWhenCaretStays(event.currentTarget, lift, onMove);
							return;
						}
						if (isImeComposing(event.nativeEvent)) return;
						const modified = event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
						if ((event.key === "Enter" || event.key === "Escape") && !modified) {
							event.preventDefault();
							onDone();
						}
					}}
				/>
			</span>
		</label>
	);
}
