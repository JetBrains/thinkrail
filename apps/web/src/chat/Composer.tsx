import type {
	ImageContent,
	SlashCommandInfo,
	ThinkingLevel,
	WireModel,
} from "@thinkrail/contracts";
import { ArrowUp, FileIcon, FolderIcon, History, Square, X } from "lucide-react";
import {
	type ClipboardEvent,
	type DragEvent,
	forwardRef,
	type KeyboardEvent,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { ModelSelector } from "./ModelSelector";
import {
	SlashCommandMenu,
	selectedSlashCommandValue,
	useSlashCommandCompletion,
} from "./SlashCommandCompletion";
import { ThinkingSelector } from "./ThinkingSelector";

/** How a submit is delivered: a fresh turn, an interrupt, or a queued message after the current turn. */
export type SubmitBehavior = "send" | "steer" | "followUp";

/** A worktree file/dir offered as an `@`-mention completion. */
export interface MentionCandidate {
	path: string;
	name: string;
	kind: "file" | "dir";
}

interface PendingImage {
	id: string;
	content: ImageContent;
}

function fileToImageContent(file: File): Promise<ImageContent> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error ?? new Error("failed to read image"));
		reader.onload = () => {
			const result = String(reader.result);
			const comma = result.indexOf(",");
			resolve({
				type: "image",
				data: comma >= 0 ? result.slice(comma + 1) : result,
				mimeType: file.type || "image/png",
			});
		};
		reader.readAsDataURL(file);
	});
}

/** The token (non-whitespace run) ending at the caret — drives `@`-mention completion. */
function activeToken(value: string, caret: number): { token: string; start: number } {
	const match = /(\S+)$/.exec(value.slice(0, caret));
	if (!match) return { token: "", start: caret };
	return { token: match[0], start: caret - match[0].length };
}

interface ComposerProps {
	value: string;
	onChange: (value: string) => void;
	isStreaming: boolean;
	commands: SlashCommandInfo[];
	mentionCandidates: MentionCandidate[];
	/** This chat's own prior user-turn texts (newest first, deduped) — backs the plain `↑` recall session
	 * below; `ChatView` derives it from `turns` via `turnAnchorText`. */
	recentPrompts: string[];
	models: WireModel[];
	currentModel: WireModel | null;
	thinkingLevel: ThinkingLevel;
	onMentionQuery: (query: string | null) => void;
	onSelectModel: (model: WireModel) => void;
	onSelectThinking: (level: ThinkingLevel) => void;
	onSubmit: (text: string, images: ImageContent[], behavior: SubmitBehavior) => void;
	onAbort: () => void;
	/** `Ctrl+R` — opens the history-recall overlay (`ChatView` seeds it with the current draft). Optional
	 * so a standalone/storybook-style render of `Composer` doesn't need to wire it. */
	onHistoryOpen?: () => void;
}

/** Imperative handle so `ChatView` can insert a recalled prompt without reaching into the DOM itself. */
export interface ComposerHandle {
	/** Replace the draft, focus the textarea, and place the caret at the end. */
	insertText: (text: string) => void;
	/** Replace the draft and send it through the composer's own submit seam — pending image attachments
	 * travel with the text and are cleared with the draft, exactly like a keyboard send. This is the
	 * history overlay's ⌘/Ctrl+Enter path; a caller-side `onSubmit` would strand the composer-private
	 * `images` state (sent without them, stale thumbnails left attached to the next message). */
	insertAndSubmit: (text: string, behavior: SubmitBehavior) => void;
}

/**
 * The chat composer (props-driven, no store/transport). Enter sends (or **steers** mid-stream);
 * Cmd/Ctrl+Enter queues a **follow-up**; a Stop button **aborts**. The model + effort controls sit in
 * the row under the tall prompt field, mirroring the New-Workspace dialog's layout. `@` opens worktree
 * file completion, a leading `/` opens the skill/command menu, `Ctrl+R` opens history recall (also
 * reachable via the always-rendered `history-open` button), plain `↑`/`↓` recall step through
 * `recentPrompts` when the field is empty or a recall session is already active, and images can be pasted
 * or dropped in.
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
	{
		value,
		onChange,
		isStreaming,
		commands,
		mentionCandidates,
		recentPrompts,
		models,
		currentModel,
		thinkingLevel,
		onMentionQuery,
		onSelectModel,
		onSelectThinking,
		onSubmit,
		onAbort,
		onHistoryOpen,
	},
	handleRef,
) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const [caret, setCaret] = useState(0);
	const [images, setImages] = useState<PendingImage[]>([]);
	const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
	const [mentionDismissed, setMentionDismissed] = useState(false);
	// The plain `↑`-recall session: `null` when inactive; otherwise an index into `recentPrompts` (0 =
	// newest). Reset on a diverging edit (the textarea's `onChange` below) or a submit — see `onKeyDown`'s
	// recall block (after the mention/slash menu) for the stepping rules.
	const [recallIdx, setRecallIdx] = useState<number | null>(null);

	const { token, start } = activeToken(value, caret);
	const mentionQuery = token.startsWith("@") ? token.slice(1) : null;

	useEffect(() => onMentionQuery(mentionQuery), [mentionQuery, onMentionQuery]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset selection when the query changes
	useEffect(() => {
		setMentionActiveIndex(0);
		setMentionDismissed(false);
	}, [mentionQuery]);

	const mentionOpen = !mentionDismissed && mentionQuery !== null && mentionCandidates.length > 0;

	// A one-shot imperative caret move requested by `focusCaret`, applied in `useLayoutEffect` below rather
	// than a `requestAnimationFrame`: RAF only guarantees "before the next paint", leaving a gap *after the
	// current task ends* where another actor touching the same textarea's selection (a fast follow-up
	// keystroke, Playwright's `fill()`, a paste) can run first — a stale RAF then collapses *that* selection
	// instead of the one it was scheduled for. Concretely: `fill()` does select-all then insert-text as
	// separate steps; if a stale RAF's `setSelectionRange(pos, pos)` fires in the gap between them, it
	// collapses the select-all to a bare caret, so the subsequent insert appends at `pos` instead of
	// replacing — producing a doubled `oldValue + newValue` (this is the exact mechanism behind the flake
	// once seen on the recall test below). `useLayoutEffect` runs synchronously in React's commit phase, in
	// the same task as the keystroke that triggered it, so there is no gap for anything else to interleave.
	const [pendingCaret, setPendingCaret] = useState<number | null>(null);

	useLayoutEffect(() => {
		if (pendingCaret === null) return;
		const el = ref.current;
		if (el) {
			el.focus();
			el.setSelectionRange(pendingCaret, pendingCaret);
		}
		setCaret(pendingCaret);
		setPendingCaret(null);
	}, [pendingCaret]);

	/** Place a collapsed caret at `pos` (after the current commit — see `pendingCaret` above). */
	const focusCaret = useCallback((pos: number) => setPendingCaret(pos), []);

	// The single seam for replacing the draft programmatically (history recall, mention, slash). Sets the
	// value, places the caret, and — crucially — exits any active `↑`-recall session: these paths set the
	// controlled `value` directly (not via the textarea's `onChange`), so the diverging-edit reset there
	// never fires, and a leftover `recallIdx` would let a subsequent `↓` overwrite what was just inserted.
	const replaceDraft = useCallback(
		(text: string, caret: number = text.length) => {
			setRecallIdx(null);
			onChange(text);
			focusCaret(caret);
		},
		[onChange, focusCaret],
	);

	// The one submit seam — the composer's own send gestures (`submit` below) and the imperative
	// `insertAndSubmit` both land here, so whatever initiated the send, pending images always travel
	// with the text and are cleared with the draft in the same step. No-op when both the (trimmed)
	// text and the image list are empty.
	const submitText = (raw: string, behavior: SubmitBehavior) => {
		const text = raw.trim();
		if (!text && images.length === 0) return;
		onSubmit(
			text,
			images.map((i) => i.content),
			behavior,
		);
		onChange("");
		setImages([]);
		setRecallIdx(null);
	};

	// No dependency array: `submitText` closes over the live draft/images on purpose, so the handle is
	// refreshed every render — memoizing it against stale closures is exactly the bug this avoids.
	useImperativeHandle(handleRef, () => ({
		insertText: (text: string) => replaceDraft(text),
		insertAndSubmit: (text: string, behavior: SubmitBehavior) => submitText(text, behavior),
	}));

	const pickMention = (c: MentionCandidate) => {
		const before = value.slice(0, start);
		const after = value.slice(caret);
		const insert = c.kind === "dir" ? `@${c.path}/` : `@${c.path}`;
		const suffix = c.kind === "dir" ? "" : " ";
		replaceDraft(
			`${before}${insert}${suffix}${after}`,
			before.length + insert.length + suffix.length,
		);
	};

	const slashCompletion = useSlashCommandCompletion({
		value,
		commands,
		onSelect: (command) => replaceDraft(selectedSlashCommandValue(command)),
	});

	// The single entry point to the history overlay — both the `Ctrl+R` chord and the always-rendered
	// history button go through here, so both dismiss any open mention/slash menu first (the two floating
	// panels share the composer's anchor rect; leaving one open would paint both at once).
	const openHistory = () => {
		setMentionDismissed(true);
		slashCompletion.dismiss();
		onHistoryOpen?.();
	};

	const addFiles = async (files: File[]) => {
		const picked = files.filter((f) => f.type.startsWith("image/"));
		if (picked.length === 0) return;
		const contents = await Promise.all(picked.map(fileToImageContent));
		setImages((prev) => [
			...prev,
			...contents.map((content) => ({ id: crypto.randomUUID(), content })),
		]);
	};

	const submit = (behavior: SubmitBehavior) => submitText(value, behavior);

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		// Ctrl+R opens history recall — guarded at the very top, before the mention/slash menu, and before
		// Enter-to-send. Ctrl+R is the browser-reload chord on Windows/Linux, so this must preventDefault
		// unconditionally; Cmd+R (mac reload) and Alt+R are left alone. Dismiss any open mention/slash menu
		// first — the two floating panels share the same anchor rect, so leaving the menu open would paint
		// both at once (mutual exclusion between the composer's floating panels).
		if (e.key === "r" && e.ctrlKey && !e.metaKey && !e.altKey) {
			e.preventDefault();
			openHistory();
			return;
		}
		if (mentionOpen) {
			const menuLen = mentionCandidates.length;
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setMentionActiveIndex((i) => (i + 1) % menuLen);
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setMentionActiveIndex((i) => (i - 1 + menuLen) % menuLen);
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				setMentionDismissed(true);
				return;
			}
			if (e.key === "Enter" || e.key === "Tab") {
				e.preventDefault();
				const candidate = mentionCandidates[mentionActiveIndex];
				if (candidate) pickMention(candidate);
				return;
			}
		}
		if (slashCompletion.handleKeyDown(e)) return;
		// Plain `↑`/`↓` recall — reached only once the mention/slash menu is closed (every menu-open branch
		// above returns before falling through, and `slashCompletion.handleKeyDown` consumes its keys while
		// its menu is open). `↑` steps in only when there's nothing to lose (an empty field) or a recall
		// session is already active, so it can never eat a draft; `↓` only steps while a session is active.
		// Both place the caret at the recalled text's end, matching `insertText`/`pickMention`/the slash
		// completion's own focus-after-change pattern.
		if (e.key === "ArrowUp" && (value === "" || recallIdx !== null) && recentPrompts.length > 0) {
			e.preventDefault();
			const next = recallIdx === null ? 0 : Math.min(recallIdx + 1, recentPrompts.length - 1);
			const text = recentPrompts[next] ?? "";
			setRecallIdx(next);
			onChange(text);
			focusCaret(text.length);
			return;
		}
		if (e.key === "ArrowDown" && recallIdx !== null) {
			e.preventDefault();
			if (recallIdx === 0) {
				setRecallIdx(null);
				onChange("");
				focusCaret(0);
			} else {
				const next = recallIdx - 1;
				const text = recentPrompts[next] ?? "";
				setRecallIdx(next);
				onChange(text);
				focusCaret(text.length);
			}
			return;
		}
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			const behavior: SubmitBehavior = isStreaming
				? e.metaKey || e.ctrlKey
					? "followUp"
					: "steer"
				: "send";
			submit(behavior);
		}
	};

	const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
		const files = [...e.clipboardData.files];
		if (files.length > 0) {
			e.preventDefault();
			void addFiles(files);
		}
	};

	const onDrop = (e: DragEvent<HTMLTextAreaElement>) => {
		if (e.dataTransfer.files.length > 0) {
			e.preventDefault();
			void addFiles([...e.dataTransfer.files]);
		}
	};

	return (
		<div className="relative flex shrink-0 flex-col border-border2 border-t bg-bg-dark">
			{mentionOpen ? (
				<div
					data-testid="mention-menu"
					className="absolute bottom-full left-sm mb-xs max-h-[40vh] w-[min(28rem,90%)] overflow-y-auto rounded-[var(--radius-md)] border border-border2 bg-elevated p-xs shadow-[var(--shadow-md)]"
				>
					{mentionCandidates.map((candidate, index) => (
						<button
							key={candidate.path}
							type="button"
							data-testid="mention-item"
							onClick={() => pickMention(candidate)}
							className={`flex w-full items-center gap-sm rounded-[var(--radius-sm)] px-sm py-xs text-left text-sm ${index === mentionActiveIndex ? "bg-hover text-text" : "text-muted"}`}
						>
							{candidate.kind === "dir" ? (
								<FolderIcon className="size-3.5 shrink-0" />
							) : (
								<FileIcon className="size-3.5 shrink-0" />
							)}
							<span className="truncate">{candidate.path}</span>
						</button>
					))}
				</div>
			) : slashCompletion.open ? (
				<SlashCommandMenu
					commands={slashCompletion.matches}
					activeIndex={slashCompletion.activeIndex}
					onSelect={slashCompletion.pick}
					className="absolute bottom-full left-sm mb-xs"
				/>
			) : null}

			{images.length > 0 ? (
				<div className="flex flex-wrap gap-xs px-sm pt-sm" data-testid="composer-images">
					{images.map((img) => (
						<span
							key={img.id}
							className="flex items-center gap-xs rounded-[var(--radius-sm)] border border-border2 bg-elevated px-sm py-xs text-text text-xs"
						>
							<FileIcon className="size-3" /> {img.content.mimeType}
							<button
								type="button"
								aria-label="Remove image"
								onClick={() => setImages((prev) => prev.filter((p) => p.id !== img.id))}
								className="text-hint hover:text-text"
							>
								<X className="size-3" />
							</button>
						</span>
					))}
				</div>
			) : null}

			<div className="flex flex-col gap-sm p-sm">
				<textarea
					ref={ref}
					data-testid="chat-input"
					value={value}
					onChange={(e) => {
						const next = e.target.value;
						// A genuine user edit (typing/pasting/deleting — never fired by the recall/insert paths
						// themselves, since those set the controlled `value` prop directly rather than mutating the
						// DOM node) that diverges from the recalled entry exits the recall session.
						if (recallIdx !== null && next !== recentPrompts[recallIdx]) setRecallIdx(null);
						onChange(next);
						setCaret(e.target.selectionStart);
					}}
					onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
					onClick={(e) => setCaret(e.currentTarget.selectionStart)}
					onKeyDown={onKeyDown}
					onPaste={onPaste}
					onDrop={onDrop}
					rows={4}
					placeholder={
						isStreaming
							? "Enter to steer · Cmd/Ctrl+Enter to queue · @ files · / commands"
							: "Message the agent…  (@ files · / commands · Enter to send)"
					}
					className="min-h-[108px] w-full resize-none rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-md py-sm text-sm text-text outline-none transition-colors placeholder:text-hint focus:border-primary focus-visible:ring-2 focus-visible:ring-[var(--primary-20)]"
				/>
				<div className="flex flex-wrap items-center gap-sm">
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-sm">
						<ModelSelector models={models} current={currentModel} onSelect={onSelectModel} />
						<ThinkingSelector level={thinkingLevel} onSelect={onSelectThinking} />
					</div>
					<div className="flex shrink-0 items-center gap-sm">
						{/* Always rendered — the tap path to history recall on mobile, and a discoverability
						 * affordance for `Ctrl+R` on desktop; both open the exact same overlay via `onHistoryOpen`. */}
						<button
							type="button"
							data-testid="history-open"
							aria-label="Search history"
							onClick={openHistory}
							className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-border2 bg-elevated text-text hover:bg-hover"
						>
							<History className="size-3.5" />
						</button>
						{isStreaming ? (
							<button
								type="button"
								data-testid="chat-abort"
								aria-label="Stop"
								onClick={onAbort}
								className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-border2 bg-elevated text-text hover:bg-hover"
							>
								<Square className="size-3.5" />
							</button>
						) : null}
						<button
							type="button"
							data-testid="chat-send"
							aria-label={isStreaming ? "Steer" : "Send"}
							onClick={() => submit(isStreaming ? "steer" : "send")}
							disabled={!value.trim() && images.length === 0}
							className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-primary text-on-accent hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
						>
							<ArrowUp className="size-4" />
						</button>
					</div>
				</div>
			</div>
		</div>
	);
});
