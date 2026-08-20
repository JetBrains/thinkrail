import type {
	ImageContent,
	SlashCommandInfo,
	ThinkingLevel,
	WireModel,
} from "@thinkrail/contracts";
import { ArrowUp, FileIcon, FolderIcon, History, Sparkles, Square, X } from "lucide-react";
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
	slashCommandQuery,
	useSlashCommandCompletion,
} from "./SlashCommandCompletion";
import type { ParsedTemplate, SlotHighlightState, SlotSegment, TemplateSlot } from "./slotSession";
import {
	highlightSegments,
	mirrorAllGroups,
	mirrorSlotGroup,
	shiftSlots,
	stripUntouchedSlots,
} from "./slotSession";
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

/** `highlightSegments`' output, one render pass, tagged with each segment's start offset — a stable,
 * content-derived React key (its position in `value`, not the array index `.map` would otherwise hand
 * out) for the backdrop's tint spans below. */
function withOffsets(segments: SlotSegment[]): (SlotSegment & { start: number })[] {
	let offset = 0;
	return segments.map((seg) => {
		const start = offset;
		offset += seg.text.length;
		return { ...seg, start };
	});
}

/** The backdrop tint utility for one `highlightSegments` state — token-only per `chat/SPEC.md`'s styling
 * rule; `"plain"` gets no tint at all (the class list is just `text-transparent`, applied unconditionally
 * by the caller). */
function highlightTint(state: SlotHighlightState): string {
	switch (state) {
		case "unfilled":
			return "rounded-[var(--radius-xs)] bg-primary-soft";
		case "active":
			return "rounded-[var(--radius-xs)] bg-primary-muted";
		case "filled":
			return "rounded-[var(--radius-xs)] bg-primary-subtle";
		case "plain":
			return "";
	}
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
	/** Catalog-freshness pass-throughs for the model picker (wired by `useModelCatalog` in ChatView). */
	modelsRefreshing: boolean;
	onRefreshModels: (force: boolean) => void;
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
	/** Opens the history-recall overlay (`ChatView` seeds it with the current draft) — the history button
	 * and the shell's global `Ctrl+R`, via the `openHistory` handle. Optional so a standalone/storybook-style
	 * render of `Composer` doesn't need to wire it. */
	onHistoryOpen?: () => void;
	/** Picking a `source: "prompt"` row: `ChatView` fetches + parses the template and replies via
	 * `insertTemplate`, instead of the slash completion's plain `/name ` insert. Optional so a standalone
	 * render of `Composer` still works — those rows just fall back to the plain insert. */
	onPickTemplate?: (name: string) => void;
	/** Open the Templates manager (Settings → Templates). Wired by `ChatView` (the store lives there, not
	 * here) to back the `/` menu's "no prompt templates yet" nudge; without it the nudge isn't rendered. */
	onManageTemplates?: () => void;
	/** Whether a `template.list` response has come back **empty** — the nudge's gate. Not derivable from
	 * `commands`: that list is equally empty before the first fetch resolves and after one fails, so
	 * reading emptiness off it would flash (or strand) a nudge that contradicts the templates the user
	 * actually has. Only the owner of the request knows, so only it can say. */
	templatesEmpty?: boolean;
}

/** Imperative handle so `ChatView` can insert a recalled prompt (or a parsed template) without reaching
 * into the DOM itself. */
export interface ComposerHandle {
	/** Replace the draft, focus the textarea, and place the caret at the end. */
	insertText: (text: string) => void;
	/** Replace the draft and send it through the composer's own submit seam — pending image attachments
	 * travel with the text and are cleared with the draft, exactly like a keyboard send. This is the
	 * history overlay's ⌘/Ctrl+Enter path; a caller-side `onSubmit` would strand the composer-private
	 * `images` state (sent without them, stale thumbnails left attached to the next message). */
	insertAndSubmit: (text: string, behavior: SubmitBehavior) => void;
	/** Replace the draft with a parsed template's expansion; if it produced any slots, start a slot
	 * session selecting slot 0 (else behaves like `insertText`: caret at the end, no session). */
	insertTemplate: (parsed: ParsedTemplate) => void;
	/** Open the history overlay the way the composer's own history button does — dismissing any open
	 * mention/slash menu first. The seam the shell's global `Ctrl+R` reaches, via `ChatView`. */
	openHistory: () => void;
	/** Return focus to the prompt field without touching the draft, so typing resumes exactly where it
	 * left off: the caret goes back where it was (tracked on every click/keyup/change), or, with a slot
	 * session live, back onto the current slot's marker selection. `ChatView` calls this when the history
	 * overlay is *dismissed* — the overlay took focus on open, and Escape would otherwise strand it on
	 * `<body>`. */
	refocus: () => void;
}

/**
 * The chat composer (props-driven, no store/transport). Enter sends (or **steers** mid-stream);
 * Cmd/Ctrl+Enter queues a **follow-up**; a Stop button **aborts**. The model + effort controls sit in
 * the row under the tall prompt field, mirroring the New-Workspace dialog's layout. `@` opens worktree
 * file completion, a leading `/` opens the skill/command menu (picking a `source: "prompt"` row starts a
 * **slot session** — see `insertTemplate`/`stepSlot` — instead of the plain `/name ` insert every other
 * row gets), the always-rendered `history-open` button opens history recall (as does the shell's global
 * `Ctrl+R`, which arrives through the `openHistory` handle rather than a key handler here),
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
		modelsRefreshing,
		onRefreshModels,
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
		onManageTemplates,
		templatesEmpty,
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
	//
	// A **ref, not state**: nothing renders from it (only the two handlers below read it), and as state it
	// was a staleness trap. Stepping writes two stores in one keystroke — this index here and the draft via
	// `onChange`, which lives in the parent — and those can commit in separate passes. In between, the
	// textarea already shows the recalled text while still carrying the *previous* render's handlers, whose
	// captured index is stale. A gesture landing in that window read the old index: a second `↑` re-recalled
	// the same entry instead of stepping, and an edit (a fast typist, a paste, Playwright's `fill()`) failed
	// to end the session — so the next `↑`/`↓` stepped from the live index and overwrote what was just typed,
	// the very loss `replaceDraft` guards against on the insert paths. A ref is read at the value it was last
	// written, so commit timing cannot come into it.
	const recallIdxRef = useRef<number | null>(null);
	// The template slot session: `null` when inactive. Starts on `insertTemplate`, steps via `stepSlot`
	// (Tab/Shift+Tab and the hint chip), re-tracked across edits in the textarea's `onChange`, and ends on
	// `Escape`, submit, or any programmatic mutation that doesn't participate in slot tracking (recall,
	// mention/plain-slash pick, `insertText`) — see `chat/SPEC.md`'s Template slots section.
	const [slots, setSlots] = useState<TemplateSlot[] | null>(null);
	const [slotIdx, setSlotIdx] = useState(0);
	// The highlight backdrop scroll-syncs to the textarea IMPERATIVELY — the textarea's `onScroll` copies
	// its offsets onto the backdrop element (a programmatic scroll offset needs no styling, so the repo's
	// token-utilities-only rule holds with zero exceptions — no state, no inline `style`, and no composer
	// re-render per scrolled frame). The ref callback seeds the offsets at mount, so a session starting
	// in an already-scrolled composer never paints even one frame misaligned.
	const backdropRef = useRef<HTMLDivElement | null>(null);
	const attachBackdrop = (el: HTMLDivElement | null) => {
		backdropRef.current = el;
		const textarea = ref.current;
		if (el && textarea) {
			el.scrollLeft = textarea.scrollLeft;
			el.scrollTop = textarea.scrollTop;
		}
	};

	const { token, start } = activeToken(value, caret);
	const mentionQuery = token.startsWith("@") ? token.slice(1) : null;
	// The same leading-`/` rule the completion hook applies (`slashCommandQuery` is its exported query
	// parser) — recomputed here only to drive the `onSlashActive` activity signal below.
	const slashQuery = slashCommandQuery(value);

	useEffect(() => onMentionQuery(mentionQuery), [mentionQuery, onMentionQuery]);
	useEffect(() => onSlashActive(slashQuery !== null), [slashQuery, onSlashActive]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset selection when the query changes
	useEffect(() => {
		setMentionActiveIndex(0);
		setMentionDismissed(false);
	}, [mentionQuery]);

	const mentionOpen = !mentionDismissed && mentionQuery !== null && mentionCandidates.length > 0;

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

	// The single seam for replacing the draft programmatically (history recall, mention, slash). Sets the
	// value, places the caret, and — crucially — exits any active `↑`-recall session (these paths set the
	// controlled `value` directly, not via the textarea's `onChange`, so the diverging-edit reset there
	// never fires, and a leftover `recallIdx` would let a subsequent `↓` overwrite what was just inserted)
	// AND any active template slot session (the inserted text has nothing to do with the tracked ranges).
	const replaceDraft = useCallback(
		(text: string, caret: number = text.length) => {
			recallIdxRef.current = null;
			setSlots(null);
			onChange(text);
			focusSelection(caret);
		},
		[onChange, focusSelection],
	);

	// The one submit seam — the composer's own send gestures (`submit` below) and the imperative
	// `insertAndSubmit` both land here, so whatever initiated the send, pending images always travel
	// with the text and are cleared with the draft in the same step (and any recall or template slot
	// session ends with the send). No-op when both the (trimmed) text and the image list are empty.
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
		recallIdxRef.current = null;
		setSlots(null);
	};

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
		// A fresh `template.list` row (`source: "prompt"`) routes to the template flow (fetch + parse +
		// slot session, owned by `ChatView`, which replies via the `insertTemplate` handle) instead of
		// the plain `/name ` insert every other row gets.
		onSelect: (command) =>
			command.source === "prompt" && onPickTemplate
				? onPickTemplate(command.name)
				: replaceDraft(selectedSlashCommandValue(command)),
	});

	// Either floating completion panel — the slot-session keys and the hint chip both stand down while
	// one is open (all the composer's floating panels share the same anchor rect).
	const menuOpen = mentionOpen || slashCompletion.open;

	// The single entry point to the history overlay — the always-rendered history button and the shell's
	// global `Ctrl+R` (via the handle below) both go through here, so both dismiss any open mention/slash
	// menu first (the two floating panels share the composer's anchor rect; leaving one open would paint
	// both at once).
	const openHistory = () => {
		setMentionDismissed(true);
		slashCompletion.dismiss();
		onHistoryOpen?.();
	};

	// No dependency array: `submitText` closes over the live draft/images on purpose, so the handle is
	// refreshed every render — memoizing it against stale closures is exactly the bug this avoids. Declared
	// after `openHistory`/`slashCompletion` so nothing here forward-references a later binding.
	useImperativeHandle(handleRef, () => ({
		insertText: (text: string) => replaceDraft(text),
		insertAndSubmit: (text: string, behavior: SubmitBehavior) => submitText(text, behavior),
		insertTemplate: (parsed: ParsedTemplate) => {
			const first = parsed.slots[0];
			if (!first) {
				// No slots — behaves exactly like `insertText` (and picks up its recall/slot resets).
				replaceDraft(parsed.text);
				return;
			}
			// A slotted insert is the one programmatic mutation that STARTS a slot session instead of
			// ending one — but it must still exit any `↑`-recall session the way `replaceDraft` does
			// (this path sets `value` directly, so the textarea's diverging-edit reset never fires).
			recallIdxRef.current = null;
			onChange(parsed.text);
			setSlots(parsed.slots);
			setSlotIdx(0);
			focusSelection(first.start, first.end);
		},
		openHistory,
		refocus: () => {
			// A live slot session gets its marker re-selected rather than a collapsed caret: the session
			// survives the overlay (Escape closes the topmost panel only), so "where the user was" is the
			// slot they were filling, and typing must still replace the whole marker.
			const slot = slots?.[slotIdx];
			if (slot) focusSelection(slot.start, slot.end);
			else focusSelection(caret);
		},
	}));

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
		// (steer/followUp), same rule; either way, the session always ends here (`submitText` resets it).
		// Mirroring runs first: Tab (`stepSlot` below) mirrors a user-edited slot's text into its same-group
		// siblings on exit, but a direct Send can fire before ever tabbing out of the slot that was actually
		// edited — e.g. filling slot 1 of a repeated-group template and clicking Send without Tab. Without
		// this, `stripUntouchedSlots` would strip the sibling as "untouched" and the group's mirrored value
		// would silently never reach it. Only user-`edited` slots mirror, so an untouched `${N:-default}`
		// never overwrites a differently-defaulted group-mate (`mirrorAllGroups`, see `slotSession.ts`).
		let text = value;
		if (slots) {
			const mirrored = mirrorAllGroups(value, slots);
			text = stripUntouchedSlots(mirrored.value, mirrored.slots);
		}
		submitText(text, behavior);
	};

	/** Tab/Shift+Tab (and the hint chip's tap): move to the next/previous slot (wrap), and — when the slot
	 * being left has been `edited` by the user (not an untouched marker, and crucially not an untouched
	 * `${N:-default}` either — an untouched default must stay independent from a differently-defaulted
	 * group-mate, see `slotSession.ts`'s `edited` doc) — mirror its current text into every OTHER slot
	 * sharing its `group` whose text differs (repeated placeholder occurrences propagate on exit, not per
	 * keystroke). `mirrorSlotGroup` (shared with `submit`'s own mirror-on-send path above) re-tracks each
	 * splice via `shiftSlots` before the next one, so later offsets in the same step stay correct even when
	 * more than one sibling needs the mirror. */
	const stepSlot = (dir: 1 | -1) => {
		if (!slots || slots.length === 0) return;
		const cur = slots[slotIdx];
		if (!cur) return;

		const { value: nextValue, slots: nextSlots } = cur.edited
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
		// There is deliberately no Ctrl+R branch here: the chord is owned app-wide by
		// `shell/useGlobalHotkeys`, which swallows the browser's reload wherever focus sits and routes back
		// into this composer through `ChatView` (the `openHistory` handle above). A textarea-local handler
		// only ever covered focus-in-composer — the reload it was written to prevent still fired everywhere
		// else.
		//
		// A slot session's own keys — checked first, before the mention/slash
		// menu's key handling, and skipped outright while a menu IS open, so a real Tab-to-pick-a-menu-item
		// (or an Escape that should dismiss the menu) is unaffected; the hint chip and the menus are mutually
		// exclusive anyway (see the hint's render gate below), so the floating UIs never fight over the
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
		// One snapshot for both branches: the ref cannot change inside a single synchronous handler, and
		// reading it once keeps it narrowable (a `.current` read is not, across statements).
		const recallAt = recallIdxRef.current;
		if (e.key === "ArrowUp" && (value === "" || recallAt !== null) && recentPrompts.length > 0) {
			e.preventDefault();
			setSlots(null);
			const next = recallAt === null ? 0 : Math.min(recallAt + 1, recentPrompts.length - 1);
			const text = recentPrompts[next] ?? "";
			recallIdxRef.current = next;
			onChange(text);
			focusSelection(text.length);
			return;
		}
		if (e.key === "ArrowDown" && recallAt !== null) {
			e.preventDefault();
			setSlots(null);
			if (recallAt === 0) {
				recallIdxRef.current = null;
				onChange("");
				focusSelection(0);
			} else {
				const next = recallAt - 1;
				const text = recentPrompts[next] ?? "";
				recallIdxRef.current = next;
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
		<div className="relative flex shrink-0 flex-col border-border-muted border-t bg-container-workspace-bg">
			{mentionOpen ? (
				<div
					data-testid="mention-menu"
					className="absolute bottom-full left-sm mb-xs max-h-[40vh] w-[min(28rem,90%)] overflow-y-auto rounded-[var(--radius-md)] border border-border-default bg-container-elevated-bg p-xs shadow-[var(--shadow-md)]"
				>
					{mentionCandidates.map((candidate, index) => (
						<button
							key={candidate.path}
							type="button"
							data-testid="mention-item"
							onClick={() => pickMention(candidate)}
							className={`flex w-full items-center gap-sm rounded-[var(--radius-sm)] px-sm py-xs text-left tr-text-ui ${index === mentionActiveIndex ? "bg-control-bg-selected text-text-default" : "text-text-muted"}`}
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
					// The nudge is about having NO templates at all — never about the current query matching
					// none — so it keys on the owner's confirmed-empty listing, not on the visible matches.
					footer={
						templatesEmpty && onManageTemplates ? (
							<button
								type="button"
								data-testid="slash-templates-empty"
								// Clears the slash query as it navigates: this row is a way OUT of the menu, not a
								// completion, so leaving `/…` in the draft would keep the (now-answered) nudge on
								// screen behind the dialog. It also matters for freshness — the template list is
								// fetched per menu-OPEN transition, so the menu has to actually close for the
								// templates the user is about to add to show up when they come back.
								onClick={() => {
									replaceDraft("");
									onManageTemplates();
								}}
								className="flex w-full items-center gap-sm rounded-[var(--radius-sm)] border-border-default border-t px-sm py-xs text-left text-text-muted tr-text-metadata hover:bg-control-bg-hovered hover:text-text-default"
							>
								<Sparkles className="size-3 shrink-0" />
								<span className="truncate">
									No prompt templates yet — add starters in Settings → Templates
								</span>
							</button>
						) : null
					}
				/>
			) : null}

			{slots && !menuOpen ? (
				<button
					type="button"
					data-testid="slot-hint"
					onClick={() => stepSlot(1)}
					className="absolute bottom-full left-sm mb-xs rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-sm py-xs text-text-muted tr-text-metadata shadow-[var(--shadow-md)] hover:bg-control-bg-hovered hover:text-text-default"
				>
					slot {slotIdx + 1}/{slots.length} · ⇥ next · esc done
				</button>
			) : null}

			{images.length > 0 ? (
				<div className="flex flex-wrap gap-xs px-sm pt-sm" data-testid="composer-images">
					{images.map((img) => (
						<span
							key={img.id}
							className="flex items-center gap-xs rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-sm py-xs text-text-default tr-text-metadata"
						>
							<FileIcon className="size-3" /> {img.content.mimeType}
							<button
								type="button"
								aria-label="Remove image"
								onClick={() => setImages((prev) => prev.filter((p) => p.id !== img.id))}
								className="text-text-muted hover:text-text-default"
							>
								<X className="size-3" />
							</button>
						</span>
					))}
				</div>
			) : null}

			<div className="flex flex-col gap-sm p-sm">
				{/* The input's border AND background live here (the textarea below is `bg-transparent` + has no
				 * border), so the backdrop's tint spans, painted behind the textarea, show through. The 1px
				 * border is on this wrapper so `bg-clip-padding` (background-clip: padding-box) clips the fill to
				 * *inside* the border — the fill can't bleed past the rounded border, and the border stays fully
				 * visible. Border colour: `control-border-default` at rest, `control-border-active` via
				 * `focus-within` while the textarea is being edited (the textarea is the only focusable child) —
				 * never an accent border. **Composer-specific:** the active border is the *single* focus outline;
				 * unlike other controls it carries NO accent focus ring (the textarea below has none), so the
				 * neutral border + accent ring never double up here. The fill is clipped by `bg-clip-padding` +
				 * `rounded` and the slot backdrop clips itself (its own `overflow-hidden` below), so this wrapper
				 * needs no `overflow-hidden`. */}
				<div className="relative rounded-[var(--radius-md)] border border-control-border-default bg-control-bg bg-clip-padding transition-colors focus-within:border-control-border-active">
					{slots ? (
						<div
							ref={attachBackdrop}
							data-testid="slot-backdrop"
							aria-hidden
							className="pointer-events-none absolute inset-0 overflow-hidden rounded-[var(--radius-md)]"
						>
							{/* Mirrors the textarea's box model EXACTLY (same px-md py-sm padding, tr-text-ui
							 * font size/line-height, a transparent border of the same width so the content box
							 * lines up) plus `whitespace-pre-wrap break-words` — a native textarea soft-wraps
							 * this way by default (its own UA stylesheet), but a plain <div> does not, so this
							 * has to be spelled out explicitly for the two to wrap identical text identically.
							 * The mirrored content overflows the `overflow-hidden` parent, whose scroll offsets
							 * the textarea's `onScroll` sets imperatively (see `attachBackdrop`). The border now
							 * lives on the wrapper (this backdrop already sits inside it), so the mirror needs only
							 * the shared `px-md py-sm` padding to line its content box up with the textarea. */}
							<div className="w-full whitespace-pre-wrap break-words px-md py-sm tr-text-ui">
								{withOffsets(highlightSegments(value, slots, slotIdx)).map((seg) => (
									<span
										key={seg.start}
										data-testid={seg.state === "plain" ? undefined : "slot-highlight"}
										data-slot-state={seg.state === "plain" ? undefined : seg.state}
										className={`text-transparent ${highlightTint(seg.state)}`}
									>
										{seg.text}
									</span>
								))}
							</div>
						</div>
					) : null}
					<textarea
						ref={ref}
						data-testid="chat-input"
						value={value}
						onScroll={(e) => {
							const backdrop = backdropRef.current;
							if (backdrop) {
								backdrop.scrollLeft = e.currentTarget.scrollLeft;
								backdrop.scrollTop = e.currentTarget.scrollTop;
							}
						}}
						onChange={(e) => {
							const next = e.target.value;
							const nextCaret = e.target.selectionStart;
							// A genuine user edit (typing/pasting/deleting — never fired by the recall/insert paths
							// themselves, since those set the controlled `value` prop directly rather than mutating the
							// DOM node) that diverges from the recalled entry exits the recall session.
							const recalled = recallIdxRef.current;
							if (recalled !== null && next !== recentPrompts[recalled]) {
								recallIdxRef.current = null;
							}
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
									// Growing IS filling (and editing): the extension is user-typed content, so `filled`
									// AND `edited` are set here too — the `touches` check below can't do it (a
									// zero-width insert at `end` doesn't overlap the range), and without it the FIRST
									// keystroke into an untouched slot at its end boundary (ArrowRight collapses the
									// marker selection exactly there, then the user types) would leave the slot
									// untouched — `stripUntouchedSlots` would then delete the marker together with
									// everything typed into it on send. `edited: true` (never set by the parser) is
									// what makes this slot a mirror source, so a user fill propagates to its group-mates
									// while an untouched `${N:-default}` stays independent (see `slotSession.ts`).
									const growing =
										removedLen === 0 &&
										insertedLen > 0 &&
										active !== undefined &&
										active.end === editStart;
									const shifted = shiftSlots(slots, editStart, removedLen, insertedLen).map(
										(slot, i) => {
											const grown =
												growing && i === slotIdx
													? { ...slot, end: slot.end + insertedLen, filled: true, edited: true }
													: slot;
											const original = slots[i];
											return original && touches(original, editStart, editEnd)
												? { ...grown, filled: true, edited: true }
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
						// `relative` keeps the textarea a positioned participant so it paints ABOVE the absolute
						// slot-highlight backdrop (its earlier DOM sibling) — otherwise a static textarea paints
						// under the backdrop and the native caret/selection get dimmed by the active-slot tint.
						className="relative min-h-[108px] w-full resize-none rounded-[var(--radius-sm)] bg-transparent px-md py-sm tr-text-ui text-text-default outline-none placeholder:text-text-muted"
					/>
				</div>
				<div className="flex flex-wrap items-center gap-sm">
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-sm">
						<ModelSelector
							models={models}
							current={currentModel}
							refreshing={modelsRefreshing}
							onRefresh={onRefreshModels}
							onSelect={onSelectModel}
						/>
						<ThinkingSelector
							level={thinkingLevel}
							levels={currentModel?.thinkingLevels ?? []}
							onSelect={onSelectThinking}
						/>
					</div>
					<div className="flex shrink-0 items-center gap-sm">
						{/* Always rendered — the tap path to history recall on mobile, and a discoverability
						 * affordance for `Ctrl+R` on desktop; both open the exact same overlay via `onHistoryOpen`. */}
						<button
							type="button"
							data-testid="history-open"
							aria-label="Search history"
							onClick={openHistory}
							className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg text-text-default hover:bg-control-bg-hovered"
						>
							<History className="size-3.5" />
						</button>
						{isStreaming ? (
							<button
								type="button"
								data-testid="chat-abort"
								aria-label="Stop"
								onClick={onAbort}
								className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg text-text-default hover:bg-control-bg-hovered"
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
							className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-control-primary-bg text-control-primary-text hover:bg-control-primary-bg-hovered disabled:pointer-events-none disabled:bg-control-disabled-bg disabled:text-control-disabled-text"
						>
							<ArrowUp className="size-4" />
						</button>
					</div>
				</div>
			</div>
		</div>
	);
});
