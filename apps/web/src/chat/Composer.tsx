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
import type { ParsedTemplate, TemplateSlot } from "./slotSession";
import { mirrorAllGroups, mirrorSlotGroup, shiftSlots, stripUntouchedSlots } from "./slotSession";
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

/**
 * Diff two textarea values around the post-edit caret (`newCaret` — always right after whatever was just
 * typed/pasted/deleted): grows the common prefix greedily but capped at `newCaret`, then grows the common
 * suffix over what's left. Capping the prefix at the caret is what keeps a coincidentally-matching run
 * elsewhere in the string (e.g. a repeated word) from being mistaken for the untouched region. Returns the
 * edit as a `[editStart, editStart + removedLen)` span of `oldVal` replaced by `insertedLen` chars of
 * `newVal` — the same shape `shiftSlots` takes.
 */
function diffValues(
	oldVal: string,
	newVal: string,
	newCaret: number,
): { editStart: number; removedLen: number; insertedLen: number } {
	const maxPrefix = Math.min(newCaret, oldVal.length, newVal.length);
	let prefix = 0;
	while (prefix < maxPrefix && oldVal[prefix] === newVal[prefix]) prefix++;

	const maxSuffix = Math.min(oldVal.length - prefix, newVal.length - prefix);
	let suffix = 0;
	while (
		suffix < maxSuffix &&
		oldVal[oldVal.length - 1 - suffix] === newVal[newVal.length - 1 - suffix]
	) {
		suffix++;
	}

	return {
		editStart: prefix,
		removedLen: oldVal.length - prefix - suffix,
		insertedLen: newVal.length - prefix - suffix,
	};
}

/** Does the edit at `[editStart, editEnd)` overlap `slot`'s range — the rule for which slot(s) get
 * flagged `filled: true` after a normal (non-session-ending) edit. */
function touches(slot: TemplateSlot, editStart: number, editEnd: number): boolean {
	return editStart < slot.end && editEnd > slot.start;
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
	/** Fires as the `/` menu opens/closes — mirrors `onMentionQuery`'s query signal, but as a plain
	 * boolean: `ChatView`'s fresh-template-list fetch cares only about activity, not the query text. */
	onSlashActive: (active: boolean) => void;
	onSelectModel: (model: WireModel) => void;
	onSelectThinking: (level: ThinkingLevel) => void;
	onSubmit: (text: string, images: ImageContent[], behavior: SubmitBehavior) => void;
	onAbort: () => void;
	/** `Ctrl+R` — opens the history-recall overlay (`ChatView` seeds it with the current draft). Optional
	 * so a standalone/storybook-style render of `Composer` doesn't need to wire it. */
	onHistoryOpen?: () => void;
	/** Picking a `source: "prompt"` row: `ChatView` fetches + parses the template and replies via
	 * `insertTemplate`, instead of `pickSlash`'s plain `/name ` insert. Optional so a standalone render of
	 * `Composer` still works — those rows just fall back to `pickSlash`. */
	onPickTemplate?: (name: string) => void;
}

/** Imperative handle so `ChatView` can insert a recalled prompt (or a parsed template) without reaching
 * into the DOM itself. */
export interface ComposerHandle {
	/** Replace the draft, focus the textarea, and place the caret at the end. */
	insertText: (text: string) => void;
	/** Replace the draft with a parsed template's expansion; if it produced any slots, start a slot
	 * session selecting slot 0 (else behaves like `insertText`: caret at the end, no session). */
	insertTemplate: (parsed: ParsedTemplate) => void;
}

/**
 * The chat composer (props-driven, no store/transport). Enter sends (or **steers** mid-stream);
 * Cmd/Ctrl+Enter queues a **follow-up**; a Stop button **aborts**. The model + effort controls sit in
 * the row under the tall prompt field, mirroring the New-Workspace dialog's layout. `@` opens worktree
 * file completion, a leading `/` opens the skill/command menu (picking a `source: "prompt"` row starts a
 * **slot session** — see `insertTemplate`/`stepSlot` — instead of the plain `/name ` insert every other
 * row gets), `Ctrl+R` opens history recall (also reachable via the always-rendered `history-open` button),
 * plain `↑`/`↓` recall step through `recentPrompts` when the field is empty or a recall session is already
 * active, and images can be pasted or dropped in.
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
		onSlashActive,
		onSelectModel,
		onSelectThinking,
		onSubmit,
		onAbort,
		onHistoryOpen,
		onPickTemplate,
	},
	handleRef,
) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const [caret, setCaret] = useState(0);
	const [images, setImages] = useState<PendingImage[]>([]);
	const [activeIndex, setActiveIndex] = useState(0);
	const [dismissed, setDismissed] = useState(false);
	// The plain `↑`-recall session: `null` when inactive; otherwise an index into `recentPrompts` (0 =
	// newest). Reset on a diverging edit (the textarea's `onChange` below) or a submit — see `onKeyDown`'s
	// recall block (after the mention/slash menu) for the stepping rules.
	const [recallIdx, setRecallIdx] = useState<number | null>(null);
	// The template slot session: `null` when inactive. Starts on `insertTemplate`, steps via `stepSlot`
	// (Tab/Shift+Tab and the hint chip), re-tracked across edits in the textarea's `onChange`, and ends on
	// `Escape`, submit, or any programmatic mutation that doesn't participate in slot tracking (recall,
	// mention/plain-slash pick, `insertText`) — see `chat/SPEC.md`'s Template slots section.
	const [slots, setSlots] = useState<TemplateSlot[] | null>(null);
	const [slotIdx, setSlotIdx] = useState(0);

	const { token, start } = activeToken(value, caret);
	const mentionQuery = token.startsWith("@") ? token.slice(1) : null;
	// Slash commands are invoked from the start of the message (e.g. `/compact`, `/skill:foo`).
	const slashQuery = value.startsWith("/") && !value.includes(" ") ? value.slice(1) : null;

	useEffect(() => onMentionQuery(mentionQuery), [mentionQuery, onMentionQuery]);
	useEffect(() => onSlashActive(slashQuery !== null), [slashQuery, onSlashActive]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset selection when the query changes
	useEffect(() => {
		setActiveIndex(0);
		setDismissed(false);
	}, [mentionQuery, slashQuery]);

	const slashMatches =
		slashQuery !== null
			? commands.filter((c) => c.name.toLowerCase().includes(slashQuery.toLowerCase())).slice(0, 8)
			: [];
	const mentionOpen = !dismissed && mentionQuery !== null && mentionCandidates.length > 0;
	const slashOpen = !dismissed && slashQuery !== null && slashMatches.length > 0;
	const menuLen = mentionOpen ? mentionCandidates.length : slashOpen ? slashMatches.length : 0;
	const menuOpen = menuLen > 0;

	// A one-shot imperative caret/selection move requested by `focusSelection`, applied in
	// `useLayoutEffect` below rather than a `requestAnimationFrame`: RAF only guarantees "before the next
	// paint", leaving a gap *after the current task ends* where another actor touching the same
	// textarea's selection (a fast follow-up keystroke, Playwright's `fill()`, a paste) can run first — a
	// stale RAF then collapses *that* selection instead of the one it was scheduled for. Concretely:
	// `fill()` does select-all then insert-text as separate steps; if a stale RAF's
	// `setSelectionRange(pos, pos)` fires in the gap between them, it collapses the select-all to a bare
	// caret, so the subsequent insert appends at `pos` instead of replacing — producing a doubled
	// `oldValue + newValue` (this is the exact mechanism behind the flake once seen on the recall test
	// below). `useLayoutEffect` runs synchronously in React's commit phase, in the same task as the
	// keystroke that triggered it, so there is no gap for anything else to interleave.
	const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number } | null>(
		null,
	);

	useLayoutEffect(() => {
		if (pendingSelection === null) return;
		const el = ref.current;
		if (el) {
			el.focus();
			el.setSelectionRange(pendingSelection.start, pendingSelection.end);
		}
		setCaret(pendingSelection.start);
		setPendingSelection(null);
	}, [pendingSelection]);

	/** Move the caret (`end` defaults to `start` — a collapsed caret) or place a real selection — a
	 * template slot's marker range needs the latter so typing over it replaces the whole thing. */
	const focusSelection = useCallback((start: number, end: number = start) => {
		setPendingSelection({ start, end });
	}, []);

	useImperativeHandle(
		handleRef,
		() => ({
			insertText: (text: string) => {
				setSlots(null);
				onChange(text);
				focusSelection(text.length);
			},
			insertTemplate: (parsed: ParsedTemplate) => {
				onChange(parsed.text);
				const first = parsed.slots[0];
				if (first) {
					setSlots(parsed.slots);
					setSlotIdx(0);
					focusSelection(first.start, first.end);
				} else {
					setSlots(null);
					focusSelection(parsed.text.length);
				}
			},
		}),
		[onChange, focusSelection],
	);

	const pickMention = (c: MentionCandidate) => {
		setSlots(null);
		const before = value.slice(0, start);
		const after = value.slice(caret);
		const insert = c.kind === "dir" ? `@${c.path}/` : `@${c.path}`;
		const suffix = c.kind === "dir" ? "" : " ";
		onChange(`${before}${insert}${suffix}${after}`);
		focusSelection(before.length + insert.length + suffix.length);
	};

	const pickSlash = (c: SlashCommandInfo) => {
		setSlots(null);
		const next = `/${c.name} `;
		onChange(next);
		focusSelection(next.length);
	};

	// A fresh `template.list` row (`source: "prompt"`) routes to the template flow (fetch + parse + slot
	// session, owned by `ChatView`) instead of the plain `/name ` insert every other row gets.
	const pickSlashCommand = (c: SlashCommandInfo) => {
		if (c.source === "prompt" && onPickTemplate) onPickTemplate(c.name);
		else pickSlash(c);
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

	const submit = (behavior: SubmitBehavior) => {
		// An active session's text is sent stripped of any untouched marker slots — sent *or* queued
		// (steer/followUp), same rule; either way, the session always ends here. Mirroring runs first: Tab
		// (`stepSlot` below) mirrors a filled slot's text into its same-group siblings on exit, but a direct
		// Send can fire before ever tabbing out of the slot that was actually filled — e.g. filling slot 1 of
		// a repeated-group template and clicking Send without Tab. Without this, `stripUntouchedSlots` would
		// strip the sibling as "untouched" and the group's mirrored value would silently never reach it.
		let text = value;
		if (slots) {
			const mirrored = mirrorAllGroups(value, slots);
			text = stripUntouchedSlots(mirrored.value, mirrored.slots);
		}
		text = text.trim();
		if (!text && images.length === 0) return;
		onSubmit(
			text,
			images.map((i) => i.content),
			behavior,
		);
		onChange("");
		setImages([]);
		setRecallIdx(null);
		setSlots(null);
	};

	/** Tab/Shift+Tab (and the hint chip's tap): move to the next/previous slot (wrap), and — when the slot
	 * being left is `filled` (real content, not an untouched marker) — mirror its current text into every
	 * OTHER slot sharing its `group` whose text differs (repeated placeholder occurrences propagate on
	 * exit, not per keystroke). `mirrorSlotGroup` (shared with `submit`'s own mirror-on-send path below)
	 * re-tracks each splice via `shiftSlots` before the next one, so later offsets in the same step stay
	 * correct even when more than one sibling needs the mirror. */
	const stepSlot = (dir: 1 | -1) => {
		if (!slots || slots.length === 0) return;
		const cur = slots[slotIdx];
		if (!cur) return;

		const { value: nextValue, slots: nextSlots } = cur.filled
			? mirrorSlotGroup(value, slots, slotIdx)
			: { value, slots };

		if (nextValue !== value) onChange(nextValue);
		setSlots(nextSlots);
		const len = nextSlots.length;
		const next = (((slotIdx + dir) % len) + len) % len;
		setSlotIdx(next);
		const target = nextSlots[next];
		if (target) focusSelection(target.start, target.end);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		// Ctrl+R opens history recall — guarded at the very top, before the mention/slash menu, and before
		// Enter-to-send. Ctrl+R is the browser-reload chord on Windows/Linux, so this must preventDefault
		// unconditionally; Cmd+R (mac reload) and Alt+R are left alone. Dismiss any open mention/slash menu
		// first — the two floating panels share the same anchor rect, so leaving the menu open would paint
		// both at once (mutual exclusion between the composer's floating panels).
		if (e.key === "r" && e.ctrlKey && !e.metaKey && !e.altKey) {
			e.preventDefault();
			setDismissed(true);
			onHistoryOpen?.();
			return;
		}
		// A slot session's own keys — checked right after the Ctrl+R guard and before the mention/slash
		// menu's key handling, and skipped outright while the menu IS open, so a real Tab-to-pick-a-menu-item
		// (or an Escape that should dismiss the menu) is unaffected; the hint chip and the menu are mutually
		// exclusive anyway (see the hint's render gate below), so the two floating UIs never fight over the
		// same key.
		if (slots && !menuOpen) {
			if (e.key === "Tab") {
				e.preventDefault();
				stepSlot(e.shiftKey ? -1 : 1);
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				setSlots(null);
				return;
			}
		}
		if (menuOpen) {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setActiveIndex((i) => (i + 1) % menuLen);
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setActiveIndex((i) => (i - 1 + menuLen) % menuLen);
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				setDismissed(true);
				return;
			}
			if (e.key === "Enter" || e.key === "Tab") {
				e.preventDefault();
				if (mentionOpen) {
					const c = mentionCandidates[activeIndex];
					if (c) pickMention(c);
				} else {
					const c = slashMatches[activeIndex];
					if (c) pickSlashCommand(c);
				}
				return;
			}
		}
		// Plain `↑`/`↓` recall — reached only once the mention/slash menu is closed (every menu-open branch
		// above returns before falling through). `↑` steps in only when there's nothing to lose (an empty
		// field) or a recall session is already active, so it can never eat a draft; `↓` only steps while a
		// session is active. Both place the caret at the recalled text's end, matching `insertText`/
		// `pickMention`/`pickSlash`'s own focus-after-change pattern.
		if (e.key === "ArrowUp" && (value === "" || recallIdx !== null) && recentPrompts.length > 0) {
			e.preventDefault();
			setSlots(null);
			const next = recallIdx === null ? 0 : Math.min(recallIdx + 1, recentPrompts.length - 1);
			const text = recentPrompts[next] ?? "";
			setRecallIdx(next);
			onChange(text);
			focusSelection(text.length);
			return;
		}
		if (e.key === "ArrowDown" && recallIdx !== null) {
			e.preventDefault();
			setSlots(null);
			if (recallIdx === 0) {
				setRecallIdx(null);
				onChange("");
				focusSelection(0);
			} else {
				const next = recallIdx - 1;
				const text = recentPrompts[next] ?? "";
				setRecallIdx(next);
				onChange(text);
				focusSelection(text.length);
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
			{menuOpen ? (
				<div
					data-testid={mentionOpen ? "mention-menu" : "slash-menu"}
					className="absolute bottom-full left-sm mb-xs max-h-[40vh] w-[min(28rem,90%)] overflow-y-auto rounded-[var(--radius-md)] border border-border2 bg-elevated p-xs shadow-[var(--shadow-md)]"
				>
					{mentionOpen
						? mentionCandidates.map((c, i) => (
								<button
									key={c.path}
									type="button"
									data-testid="mention-item"
									onClick={() => pickMention(c)}
									className={`flex w-full items-center gap-sm rounded-[var(--radius-sm)] px-sm py-xs text-left text-sm ${i === activeIndex ? "bg-hover text-text" : "text-muted"}`}
								>
									{c.kind === "dir" ? (
										<FolderIcon className="size-3.5 shrink-0" />
									) : (
										<FileIcon className="size-3.5 shrink-0" />
									)}
									<span className="truncate">{c.path}</span>
								</button>
							))
						: slashMatches.map((c, i) => (
								<button
									key={`${c.source}:${c.name}`}
									type="button"
									data-testid="slash-command"
									data-source={c.source}
									onClick={() => pickSlashCommand(c)}
									className={`flex w-full items-center gap-sm rounded-[var(--radius-sm)] px-sm py-xs text-left text-sm ${i === activeIndex ? "bg-hover text-text" : "text-muted"}`}
								>
									<span className="font-mono text-text">/{c.name}</span>
									{c.description ? <span className="truncate text-xs">{c.description}</span> : null}
									<span className="ml-auto shrink-0 text-hint text-xs">
										{c.source}/{c.sourceInfo.scope}
									</span>
								</button>
							))}
				</div>
			) : null}

			{slots && !menuOpen ? (
				<button
					type="button"
					data-testid="slot-hint"
					onClick={() => stepSlot(1)}
					className="absolute bottom-full left-sm mb-xs rounded-[var(--radius-sm)] border border-border2 bg-elevated px-sm py-xs text-hint text-xs shadow-[var(--shadow-md)] hover:bg-hover hover:text-text"
				>
					slot {slotIdx + 1}/{slots.length} · ⇥ next · esc done
				</button>
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
						const nextCaret = e.target.selectionStart;
						// A genuine user edit (typing/pasting/deleting — never fired by the recall/insert paths
						// themselves, since those set the controlled `value` prop directly rather than mutating the
						// DOM node) that diverges from the recalled entry exits the recall session.
						if (recallIdx !== null && next !== recentPrompts[recallIdx]) setRecallIdx(null);
						if (slots) {
							const { editStart, removedLen, insertedLen } = diffValues(value, next, nextCaret);
							if (editStart === 0 && removedLen === value.length) {
								// The edit consumed the entire prior value (a select-all-and-type/delete, or
								// Playwright's `fill()`) — re-tracking a now-meaningless collapsed range set would
								// serve no purpose, so the session just ends instead.
								setSlots(null);
							} else {
								const editEnd = editStart + removedLen;
								const active = slots[slotIdx];
								// Still typing at the exact end of the actively-selected slot should keep extending
								// it. `shiftSlots`' boundary rule otherwise treats a zero-width insert exactly at a
								// slot's `end` as landing just *after* it (the right default in general — text typed
								// after a filled value shouldn't retroactively join it), which would otherwise
								// truncate a multi-character fill to whatever was typed in the very first keystroke.
								const growing =
									removedLen === 0 &&
									insertedLen > 0 &&
									active !== undefined &&
									active.end === editStart;
								const shifted = shiftSlots(slots, editStart, removedLen, insertedLen).map(
									(slot, i) => {
										const grown =
											growing && i === slotIdx ? { ...slot, end: slot.end + insertedLen } : slot;
										const original = slots[i];
										return original && touches(original, editStart, editEnd)
											? { ...grown, filled: true }
											: grown;
									},
								);
								setSlots(shifted);
							}
						}
						onChange(next);
						setCaret(nextCaret);
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
							onClick={() => onHistoryOpen?.()}
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
