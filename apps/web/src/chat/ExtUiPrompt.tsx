import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { cn } from "@thinkrail/ui/utils";
import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { AttentionLine } from "./AttentionLine";
import { ACTIVITY_BREADCRUMB_HEIGHT } from "./activityBreadcrumbs";
import { useChatActions } from "./ChatActions";
import { ToolArgList, toolArgEntries } from "./ToolArgList";
import type { ExtUiDialogRequest } from "./types";

export type ExtUiReply = (value: string | boolean | null) => void;

const ACTIONS_ROW = "flex flex-wrap items-center gap-4 @max-md:flex-col @max-md:items-stretch";
const OPTION_BUTTON =
	"h-auto min-h-28 max-w-full justify-start whitespace-normal break-words py-4 text-left";

export function ExtUiPrompt({
	request,
	onReply,
	draft,
	onDraftChange,
	claimReveal,
	className,
}: {
	request: ExtUiDialogRequest;
	onReply: ExtUiReply;
	draft?: string | undefined;
	onDraftChange?: ((text: string) => void) | undefined;
	claimReveal?: (() => boolean) | undefined;
	className?: string;
}) {
	const t = useT();
	const [text, setTextState] = useState(
		draft ?? (request.kind === "editor" ? (request.prefill ?? "") : ""),
	);
	const setText = (next: string) => {
		setTextState(next);
		onDraftChange?.(next);
	};
	const rootRef = useRef<HTMLElement>(null);
	const titleId = useId();
	const hintId = useId();
	const actions = useChatActions();
	const [heading, ...details] = request.title.split("\n");
	const detail = details.join("\n").trim();
	const anchored = request.toolCallId !== undefined;
	const toolArgs = request.toolInput ? toolArgEntries(request.toolInput) : [];

	useEffect(() => {
		if (!anchored) return;
		const yieldToUser = () => actions?.cancelAutomaticReveal();
		const frame = requestAnimationFrame(() => {
			const root = rootRef.current;
			if (!root || !claimReveal?.()) return;
			window.addEventListener("pointerdown", yieldToUser, { capture: true, once: true });
			window.addEventListener("keydown", yieldToUser, { capture: true, once: true });
			window.addEventListener("wheel", yieldToUser, { capture: true, once: true, passive: true });
			actions?.revealChatElement(root, {
				block: "nearest",
				provenance: "automatic-attention",
				runway: "release",
				stability: "bounded",
				topInset: ACTIVITY_BREADCRUMB_HEIGHT,
			});
		});
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("pointerdown", yieldToUser, { capture: true });
			window.removeEventListener("keydown", yieldToUser, { capture: true });
			window.removeEventListener("wheel", yieldToUser, { capture: true });
		};
	}, [actions, anchored, claimReveal]);

	const answer: ExtUiReply = (value) => {
		const held = document.activeElement;
		if (held && rootRef.current?.contains(held) && held.matches(":focus-visible")) {
			actions?.focusComposer();
		}
		onReply(value);
	};
	const cancel = () => answer(request.kind === "confirm" ? false : null);
	const field = { "aria-labelledby": titleId, "aria-describedby": hintId };

	return (
		<div className={cn("flex min-h-0 flex-col gap-4 motion-safe:animate-reveal", className)}>
			<AttentionLine live={false} />
			<section
				ref={rootRef}
				aria-labelledby={titleId}
				aria-describedby={hintId}
				data-testid="ext-ui-prompt"
				data-kind={request.kind}
				data-tool-call-id={request.toolCallId}
				className="@container flex min-h-0 flex-col gap-8 rounded-sm border border-primary bg-container-elevated-bg p-8 tr-text-ui text-text-default ring-2 ring-primary-soft"
			>
				<div className="flex min-h-0 flex-col gap-8 overflow-y-auto">
					<div className="flex flex-col gap-2">
						<span id={titleId} data-testid="ext-ui-title" className="break-words">
							{heading}
						</span>
						{detail ? (
							<span
								data-testid="ext-ui-detail"
								className="whitespace-pre-wrap break-words text-text-muted"
							>
								{detail}
							</span>
						) : null}
						{request.kind === "confirm" && request.message ? (
							<span className="whitespace-pre-wrap break-words text-text-muted">
								{request.message}
							</span>
						) : null}
					</div>

					{toolArgs.length > 0 ? (
						<ToolArgList
							data-testid="ext-ui-tool-input"
							aria-label={t("chat.extUi.arguments")}
							tabIndex={0}
							entries={toolArgs}
							className="max-h-[40vh] shrink-0 overflow-y-auto rounded-sm bg-container-header-bg px-8 py-4 outline-none focus-visible:ring-2 focus-visible:ring-primary"
						/>
					) : null}

					{request.kind === "input" ? (
						<input
							{...field}
							data-testid="ext-ui-input"
							value={text}
							placeholder={request.placeholder ?? ""}
							onChange={(e) => setText(e.target.value)}
							onKeyDown={(e) => {
								if (isImeComposing(e.nativeEvent)) return;
								if (e.key === "Enter") {
									e.preventDefault();
									answer(text);
								}
							}}
							className="rounded-sm border border-control-border-default bg-control-bg px-8 py-4 tr-text-ui text-text-default outline-none placeholder:text-text-muted focus-visible:border-control-border-active"
						/>
					) : null}

					{request.kind === "editor" ? (
						<textarea
							{...field}
							data-testid="ext-ui-editor"
							value={text}
							rows={6}
							onChange={(e) => setText(e.target.value)}
							className="max-h-[40cqh] min-h-[6lh] resize-y rounded-sm border border-control-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default outline-none focus-visible:border-control-border-active"
						/>
					) : null}

					{request.kind === "select" ? (
						<div data-testid="ext-ui-actions" className={ACTIONS_ROW}>
							{request.options.map((option) => (
								<Button
									key={option}
									size="sm"
									variant="outline"
									data-testid="ext-ui-option"
									onClick={() => answer(option)}
									className={OPTION_BUTTON}
								>
									{option}
								</Button>
							))}
						</div>
					) : null}
				</div>

				{request.kind === "select" ? null : (
					<div data-testid="ext-ui-actions" className={cn(ACTIONS_ROW, "shrink-0")}>
						<Button
							size="sm"
							variant="outline"
							data-testid="ext-ui-cancel"
							onClick={cancel}
							className={OPTION_BUTTON}
						>
							{t("common.cancel")}
						</Button>
						<Button
							size="sm"
							data-testid="ext-ui-submit"
							onClick={() => answer(request.kind === "confirm" ? true : text)}
							className={OPTION_BUTTON}
						>
							{request.kind === "confirm" ? t("chat.extUi.ok") : t("chat.extUi.submit")}
						</Button>
					</div>
				)}
				<p
					id={hintId}
					data-testid="ext-ui-hint"
					className="shrink-0 border-border-muted border-t pt-4 text-text-muted tr-text-metadata"
				>
					{t("chat.extUi.cancelHint")}
				</p>
			</section>
		</div>
	);
}

export interface PendingExtUi {
	request: ExtUiDialogRequest;
	reply: ExtUiReply;
	draft: () => string | undefined;
	rememberDraft: (text: string) => void;
	claimReveal: () => boolean;
}

export function PendingExtUiPrompt({
	pending,
	className,
}: {
	pending: PendingExtUi;
	className?: string;
}) {
	return (
		<ExtUiPrompt
			key={pending.request.id}
			request={pending.request}
			onReply={pending.reply}
			draft={pending.draft()}
			onDraftChange={pending.rememberDraft}
			claimReveal={pending.claimReveal}
			{...(className ? { className } : {})}
		/>
	);
}

export const PendingExtUiContext = createContext<PendingExtUi | null>(null);

export function usePendingExtUiFor(toolCallId: string): PendingExtUi | null {
	const pending = useContext(PendingExtUiContext);
	return pending?.request.toolCallId === toolCallId ? pending : null;
}

export function ToolPromptSlot({
	toolCallId,
	className,
}: {
	toolCallId: string;
	className?: string;
}) {
	const pending = usePendingExtUiFor(toolCallId);
	if (!pending) return null;
	return <PendingExtUiPrompt pending={pending} {...(className ? { className } : {})} />;
}
