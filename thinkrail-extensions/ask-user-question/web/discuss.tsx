import {
	RiChat3Fill as ChatFill,
	RiChat3Line as ChatLine,
	RiInformationLine as ContextGlyph,
	RiProhibitedLine as IrrelevantGlyph,
	type RemixiconComponentType,
	RiQuestionLine as UnclearGlyph,
} from "@remixicon/react";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import type { AskUserQuestionDiscussReason } from "@thinkrail/pi-ask-user-question/core";
import { Button, withIconClass } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { cn } from "@thinkrail/ui/utils";
import { AutosizeField } from "./AutosizeField";
import { useTestId } from "./ghost";
import { DISCUSS_REASONS } from "./state";

const REASON_COPY: Record<
	AskUserQuestionDiscussReason,
	{ label: MessageKey; Icon: RemixiconComponentType }
> = {
	unclear: { label: "tools.ask.discussReason.unclear", Icon: UnclearGlyph },
	irrelevant: { label: "tools.ask.discussReason.irrelevant", Icon: IrrelevantGlyph },
	context: { label: "tools.ask.discussReason.context", Icon: ContextGlyph },
};

const DiscussingGlyph = withIconClass(ChatFill, "text-feedback-info");

export function discussReasonKey(reason: AskUserQuestionDiscussReason): MessageKey {
	return REASON_COPY[reason].label;
}

export function DiscussToggle({
	active,
	buttonRef,
	onToggle,
}: {
	active: boolean;
	buttonRef: (node: HTMLButtonElement | null) => void;
	onToggle: () => void;
}) {
	const t = useT();
	const tid = useTestId();
	return (
		<Button
			ref={buttonRef}
			variant="ghost"
			size="m"
			selected={active}
			iconLeft={active ? DiscussingGlyph : ChatLine}
			tabIndex={0}
			aria-pressed={active}
			data-testid={tid("ask-discuss")}
			data-active={active}
			onClick={onToggle}
			className="shrink-0"
		>
			{active ? t("tools.ask.discussing") : t("tools.ask.discuss")}
		</Button>
	);
}

export function DiscussPanel({
	reason,
	text,
	panelRef,
	fieldRef,
	onReason,
	onText,
	onDone,
	onReopen,
	onUp,
	onDown,
}: {
	reason: AskUserQuestionDiscussReason | null;
	text: string;
	panelRef: (node: HTMLFieldSetElement | null) => void;
	fieldRef: (node: HTMLTextAreaElement | null) => void;
	onReason: (reason: AskUserQuestionDiscussReason) => void;
	onText: (text: string) => void;
	onDone: () => void;
	onReopen: () => void;
	onUp: () => void;
	onDown: () => void;
}) {
	const t = useT();
	const tid = useTestId();
	return (
		<fieldset
			ref={panelRef}
			aria-label={t("tools.ask.discussing")}
			tabIndex={-1}
			data-testid={tid("ask-discuss-panel")}
			onKeyDown={(event) => {
				if (event.target !== event.currentTarget) return;
				if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onReopen();
				} else if (event.key === "ArrowUp") {
					event.preventDefault();
					onUp();
				} else if (event.key === "ArrowDown") {
					event.preventDefault();
					onDown();
				}
			}}
			className="flex min-w-0 flex-col gap-8 rounded-md border border-feedback-info-muted bg-feedback-info-subtle p-12 outline-none focus-visible:ring-2 focus-visible:ring-primary"
		>
			<div className="flex items-start gap-8 tr-text-ui text-text-default">
				<ChatLine aria-hidden="true" className="mt-2 size-16 shrink-0 text-feedback-info" />
				{t("tools.ask.discussLead")}
			</div>
			<div className="flex flex-wrap items-center gap-4">
				<span className="text-text-muted tr-text-metadata">{t("tools.ask.discussWhy")}</span>
				{DISCUSS_REASONS.map((option) => {
					const { label, Icon } = REASON_COPY[option];
					const on = reason === option;
					return (
						<button
							key={option}
							type="button"
							tabIndex={0}
							aria-pressed={on}
							data-testid={tid("ask-discuss-reason")}
							data-reason={option}
							onClick={() => onReason(option)}
							className={cn(
								"inline-flex items-center gap-4 rounded-full border px-8 py-2 tr-text-metadata outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
								on
									? "border-feedback-info bg-container-elevated-bg text-text-default"
									: "border-border-default text-text-muted hover:bg-control-bg-hovered",
							)}
						>
							<Icon className={cn("size-12 shrink-0", on && "text-feedback-info")} />
							{t(label)}
						</button>
					);
				})}
			</div>
			<AutosizeField
				fieldRef={fieldRef}
				tabIndex={0}
				data-testid={tid("ask-discuss-text")}
				data-ask-discuss-text=""
				data-ask-page-focus="true"
				aria-label={t("tools.ask.discussTextLabel")}
				aria-keyshortcuts="Enter Escape Shift+Enter Meta+Enter Control+Enter"
				value={text}
				placeholder={t("tools.ask.discussPlaceholder")}
				onChange={(event) => onText(event.target.value)}
				onKeyDown={(event) => {
					if (isImeComposing(event.nativeEvent)) return;
					const modified = event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
					if ((event.key === "Enter" || event.key === "Escape") && !modified) {
						event.preventDefault();
						event.stopPropagation();
						onDone();
					}
				}}
				className="bg-container-elevated-bg"
			/>
			<div className="text-text-muted tr-text-metadata">{t("tools.ask.discussHint")}</div>
		</fieldset>
	);
}
