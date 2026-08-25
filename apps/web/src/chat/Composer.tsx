import {
	REQUEST_IMAGE_BASE64_BUDGET,
	type SlashCommandInfo,
	type ThinkingLevel,
	type WireModel,
} from "@thinkrail/contracts";
import {
	ArrowUp,
	ChevronUp,
	FileIcon,
	FolderIcon,
	History,
	Sparkles,
	Square,
	X,
} from "lucide-react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FileChip } from "./FileChip";
import { type AttachedImage, fileToAttachedImage } from "./imageAttachment";
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
import type { ChatAttachment } from "./types";

export type SubmitBehavior = "send" | "steer" | "followUp" | "interrupt";

const STREAMING_SEND_MODES = [
	{
		behavior: "steer" as const,
		name: "Steer",
		meaning: "delivers at the agent's next step",
		keys: "Enter",
		testid: "send-mode-steer",
	},
	{
		behavior: "followUp" as const,
		name: "Queue",
		meaning: "runs after the agent finishes",
		keys: "Cmd/Ctrl+Enter",
		testid: "send-mode-queue",
	},
	{
		behavior: "interrupt" as const,
		name: "Interrupt",
		meaning: "stops the current response and sends now",
		keys: "Cmd/Ctrl+Shift+Enter",
		testid: "send-mode-interrupt",
	},
];

export interface MentionCandidate {
	path: string;
	name: string;
	kind: "file" | "dir";
}

interface PendingImage extends AttachedImage {
	id: string;
	name: string;
}

interface AttachError {
	id: string;
	name: string;
	reason: string;
}

function activeToken(value: string, caret: number): { token: string; start: number } {
	const match = /(\S+)$/.exec(value.slice(0, caret));
	if (!match) return { token: "", start: caret };
	return { token: match[0], start: caret - match[0].length };
}

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

function touches(slot: TemplateSlot, editStart: number, editEnd: number): boolean {
	return editStart < slot.end && editEnd > slot.start;
}

function withOffsets(segments: SlotSegment[]): (SlotSegment & { start: number })[] {
	let offset = 0;
	return segments.map((seg) => {
		const start = offset;
		offset += seg.text.length;
		return { ...seg, start };
	});
}

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
	recentPrompts: string[];
	models: WireModel[];
	modelsRefreshing: boolean;
	onRefreshModels: (force: boolean) => void;
	currentModel: WireModel | null;
	thinkingLevel: ThinkingLevel;
	onMentionQuery: (query: string | null) => void;
	onSlashActive: (active: boolean) => void;
	onSelectModel: (model: WireModel) => void;
	onSelectThinking: (level: ThinkingLevel) => void;
	onSubmit: (text: string, attachments: ChatAttachment[], behavior: SubmitBehavior) => void;
	onAbort: () => void;
	onHistoryOpen?: () => void;
	onPickTemplate?: (name: string) => void;
	onManageTemplates?: () => void;
	templatesEmpty?: boolean;
}

export interface ComposerHandle {
	insertText: (text: string) => void;
	insertAndSubmit: (text: string, behavior: SubmitBehavior) => void;
	insertTemplate: (parsed: ParsedTemplate) => void;
	openHistory: () => void;
	refocus: () => void;
}

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
	const imagesRef = useRef<PendingImage[]>([]);
	const commitImages = (next: PendingImage[]) => {
		imagesRef.current = next;
		setImages(next);
	};
	const [pendingImages, setPendingImages] = useState(0);
	const [attachErrors, setAttachErrors] = useState<AttachError[]>([]);
	const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
	const [mentionDismissed, setMentionDismissed] = useState(false);
	const [sendMenuOpen, setSendMenuOpen] = useState(false);
	const recallIdxRef = useRef<number | null>(null);
	const [slots, setSlots] = useState<TemplateSlot[] | null>(null);
	const [slotIdx, setSlotIdx] = useState(0);
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
	const slashQuery = slashCommandQuery(value);

	useEffect(() => onMentionQuery(mentionQuery), [mentionQuery, onMentionQuery]);
	useEffect(() => onSlashActive(slashQuery !== null), [slashQuery, onSlashActive]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset selection when the query changes
	useEffect(() => {
		setMentionActiveIndex(0);
		setMentionDismissed(false);
	}, [mentionQuery]);

	const mentionOpen = !mentionDismissed && mentionQuery !== null && mentionCandidates.length > 0;

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

	const focusSelection = useCallback((start: number, end: number = start) => {
		setPendingSelection({ start, end });
	}, []);

	const replaceDraft = useCallback(
		(text: string, caret: number = text.length) => {
			recallIdxRef.current = null;
			setSlots(null);
			onChange(text);
			focusSelection(caret);
		},
		[onChange, focusSelection],
	);

	const canSubmit = (raw: string) => pendingImages === 0 && (!!raw.trim() || images.length > 0);

	const submitText = (raw: string, behavior: SubmitBehavior) => {
		if (!canSubmit(raw)) return;
		const text = raw.trim();
		onSubmit(
			text,
			images.map(({ name, content }) => ({ name, content })),
			behavior,
		);
		onChange("");
		commitImages([]);
		setAttachErrors([]);
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
		onSelect: (command) =>
			command.source === "prompt" && onPickTemplate
				? onPickTemplate(command.name)
				: replaceDraft(selectedSlashCommandValue(command)),
	});

	const menuOpen = mentionOpen || slashCompletion.open;

	const openHistory = () => {
		setMentionDismissed(true);
		slashCompletion.dismiss();
		onHistoryOpen?.();
	};

	useImperativeHandle(handleRef, () => ({
		insertText: (text: string) => replaceDraft(text),
		insertAndSubmit: (text: string, behavior: SubmitBehavior) =>
			canSubmit(text) ? submitText(text, behavior) : replaceDraft(text),
		insertTemplate: (parsed: ParsedTemplate) => {
			const first = parsed.slots[0];
			if (!first) {
				replaceDraft(parsed.text);
				return;
			}
			recallIdxRef.current = null;
			onChange(parsed.text);
			setSlots(parsed.slots);
			setSlotIdx(0);
			focusSelection(first.start, first.end);
		},
		openHistory,
		refocus: () => {
			const slot = slots?.[slotIdx];
			if (slot) focusSelection(slot.start, slot.end);
			else focusSelection(caret);
		},
	}));

	const addFiles = async (files: File[]) => {
		const picked = files.filter((f) => f.type.startsWith("image/"));
		if (picked.length === 0) return;
		setPendingImages((n) => n + picked.length);
		try {
			const settled = await Promise.allSettled(picked.map(fileToAttachedImage));
			let used = imagesRef.current.reduce((sum, p) => sum + p.content.data.length, 0);
			const additions: PendingImage[] = [];
			const errors: AttachError[] = [];
			settled.forEach((result, i) => {
				const name = picked[i]?.name || "image";
				if (result.status !== "fulfilled" || result.value === null) {
					errors.push({ id: crypto.randomUUID(), name, reason: "unsupported image format" });
					return;
				}
				const size = result.value.content.data.length;
				if (used + size > REQUEST_IMAGE_BASE64_BUDGET) {
					errors.push({ id: crypto.randomUUID(), name, reason: "message image limit reached" });
					return;
				}
				used += size;
				additions.push({
					id: crypto.randomUUID(),
					name,
					...result.value,
				});
			});
			if (additions.length > 0) commitImages([...imagesRef.current, ...additions]);
			if (errors.length > 0) setAttachErrors((prev) => [...prev, ...errors]);
		} finally {
			setPendingImages((n) => n - picked.length);
		}
	};

	const submit = (behavior: SubmitBehavior) => {
		let text = value;
		if (slots) {
			const mirrored = mirrorAllGroups(value, slots);
			text = stripUntouchedSlots(mirrored.value, mirrored.slots);
		}
		submitText(text, behavior);
	};

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
		if (e.key === "Enter" && e.shiftKey && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			submit(isStreaming ? "interrupt" : "send");
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
					footer={
						templatesEmpty && onManageTemplates ? (
							<button
								type="button"
								data-testid="slash-templates-empty"
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

			{images.length > 0 || pendingImages > 0 || attachErrors.length > 0 ? (
				<div className="flex flex-wrap gap-xs px-sm pt-sm" data-testid="composer-images">
					{attachErrors.map((err) => (
						<FileChip
							key={err.id}
							data-testid="composer-image-error"
							tone="error"
							icon={false}
							title={`Couldn't attach ${err.name} — ${err.reason}`}
							label={`Couldn't attach ${err.name}`}
							meta={`— ${err.reason}`}
							trailing={
								<button
									type="button"
									aria-label="Dismiss"
									onClick={() => setAttachErrors((prev) => prev.filter((p) => p.id !== err.id))}
									className="hover:opacity-80"
								>
									<X className="size-3" />
								</button>
							}
						/>
					))}
					{images.map((img) => (
						<FileChip
							key={img.id}
							data-testid="composer-image"
							data-width={img.width}
							data-height={img.height}
							data-mime={img.content.mimeType}
							title={img.name}
							label={img.name}
							meta={img.width && img.height ? ` · ${img.width}×${img.height}` : undefined}
							trailing={
								<button
									type="button"
									aria-label="Remove image"
									onClick={() => commitImages(imagesRef.current.filter((p) => p.id !== img.id))}
									className="text-text-muted hover:text-text-default"
								>
									<X className="size-3" />
								</button>
							}
						/>
					))}
					{pendingImages > 0 ? (
						<FileChip
							data-testid="composer-image-pending"
							label={
								<span className="text-text-muted">
									{pendingImages === 1 ? "Attaching…" : `Attaching ${pendingImages}…`}
								</span>
							}
						/>
					) : null}
				</div>
			) : null}

			<div className="flex flex-col gap-sm p-sm">
				<div className="relative rounded-[var(--radius-md)] border border-control-border-default bg-control-bg bg-clip-padding transition-colors focus-within:border-control-border-active">
					{slots ? (
						<div
							ref={attachBackdrop}
							data-testid="slot-backdrop"
							aria-hidden
							className="pointer-events-none absolute inset-0 overflow-hidden rounded-[var(--radius-md)]"
						>
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
							const recalled = recallIdxRef.current;
							if (recalled !== null && next !== recentPrompts[recalled]) {
								recallIdxRef.current = null;
							}
							if (slots) {
								const { editStart, removedLen, insertedLen } = diffValues(value, next, nextCaret);
								if (editStart === 0 && removedLen === value.length) {
									setSlots(null);
								} else {
									const editEnd = editStart + removedLen;
									const active = slots[slotIdx];
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
								? "Enter steers at the next step · Cmd/Ctrl+Enter queues for when it finishes"
								: "Message the agent…  (@ files · / commands · Enter to send)"
						}
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
						{isStreaming ? (
							<Popover open={sendMenuOpen} onOpenChange={setSendMenuOpen}>
								<PopoverTrigger asChild>
									<button
										type="button"
										data-testid="send-menu"
										aria-label="Send options"
										className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg text-text-default hover:bg-control-bg-hovered"
									>
										<ChevronUp className="size-3.5" />
									</button>
								</PopoverTrigger>
								<PopoverContent side="top" align="end" className="w-[320px] p-xs">
									<div className="flex flex-col gap-2xs">
										{STREAMING_SEND_MODES.map((mode) => (
											<button
												key={mode.behavior}
												type="button"
												data-testid={mode.testid}
												disabled={!canSubmit(value)}
												onClick={() => {
													setSendMenuOpen(false);
													submit(mode.behavior);
												}}
												className="flex w-full flex-col gap-2xs rounded-[var(--radius-sm)] px-sm py-xs text-left hover:bg-control-bg-hovered disabled:pointer-events-none disabled:opacity-50"
											>
												<span className="flex w-full items-baseline justify-between gap-sm">
													<span className="text-text-default tr-text-ui">{mode.name}</span>
													<span className="shrink-0 text-text-muted tr-text-metadata">
														{mode.keys}
													</span>
												</span>
												<span className="text-text-muted tr-text-metadata">{mode.meaning}</span>
											</button>
										))}
									</div>
								</PopoverContent>
							</Popover>
						) : null}
						<button
							type="button"
							data-testid="chat-send"
							aria-label={isStreaming ? "Steer" : "Send"}
							onClick={() => submit(isStreaming ? "steer" : "send")}
							disabled={!canSubmit(value)}
							className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-control-primary-bg text-control-primary-text hover:bg-control-primary-bg-hovered disabled:pointer-events-none disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text"
						>
							<ArrowUp className="size-4" />
						</button>
					</div>
				</div>
			</div>
		</div>
	);
});
