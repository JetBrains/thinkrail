import type { ImageContent, SlashCommandInfo } from "@thinkrail-pi/contracts";
import { ArrowUp, FileIcon, FolderIcon, Square, X } from "lucide-react";
import {
	type ClipboardEvent,
	type DragEvent,
	type KeyboardEvent,
	useEffect,
	useRef,
	useState,
} from "react";

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
 * The chat composer (props-driven, no store/transport). Enter sends (or **steers** mid-stream);
 * Cmd/Ctrl+Enter queues a **follow-up**; a Stop button **aborts**. `@` opens worktree file completion,
 * a leading `/` opens the skill/command menu, and images can be pasted or dropped in.
 */
export function Composer({
	value,
	onChange,
	isStreaming,
	commands,
	mentionCandidates,
	onMentionQuery,
	onSubmit,
	onAbort,
}: {
	value: string;
	onChange: (value: string) => void;
	isStreaming: boolean;
	commands: SlashCommandInfo[];
	mentionCandidates: MentionCandidate[];
	onMentionQuery: (query: string | null) => void;
	onSubmit: (text: string, images: ImageContent[], behavior: SubmitBehavior) => void;
	onAbort: () => void;
}) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const [caret, setCaret] = useState(0);
	const [images, setImages] = useState<PendingImage[]>([]);
	const [activeIndex, setActiveIndex] = useState(0);
	const [dismissed, setDismissed] = useState(false);

	const { token, start } = activeToken(value, caret);
	const mentionQuery = token.startsWith("@") ? token.slice(1) : null;
	// Slash commands are invoked from the start of the message (e.g. `/compact`, `/skill:foo`).
	const slashQuery = value.startsWith("/") && !value.includes(" ") ? value.slice(1) : null;

	useEffect(() => onMentionQuery(mentionQuery), [mentionQuery, onMentionQuery]);
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

	const focusCaret = (pos: number) => {
		requestAnimationFrame(() => {
			const el = ref.current;
			if (!el) return;
			el.focus();
			el.setSelectionRange(pos, pos);
			setCaret(pos);
		});
	};

	const pickMention = (c: MentionCandidate) => {
		const before = value.slice(0, start);
		const after = value.slice(caret);
		const insert = c.kind === "dir" ? `@${c.path}/` : `@${c.path}`;
		const suffix = c.kind === "dir" ? "" : " ";
		onChange(`${before}${insert}${suffix}${after}`);
		focusCaret(before.length + insert.length + suffix.length);
	};

	const pickSlash = (c: SlashCommandInfo) => {
		const next = `/${c.name} `;
		onChange(next);
		focusCaret(next.length);
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
		const text = value.trim();
		if (!text && images.length === 0) return;
		onSubmit(
			text,
			images.map((i) => i.content),
			behavior,
		);
		onChange("");
		setImages([]);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
					if (c) pickSlash(c);
				}
				return;
			}
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
									onClick={() => pickSlash(c)}
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

			<div className="flex items-end gap-sm p-sm">
				<textarea
					ref={ref}
					data-testid="chat-input"
					value={value}
					onChange={(e) => {
						onChange(e.target.value);
						setCaret(e.target.selectionStart);
					}}
					onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
					onClick={(e) => setCaret(e.currentTarget.selectionStart)}
					onKeyDown={onKeyDown}
					onPaste={onPaste}
					onDrop={onDrop}
					rows={2}
					placeholder={
						isStreaming
							? "Enter to steer · Cmd/Ctrl+Enter to queue · @ files · / commands"
							: "Message the agent…  (@ files · / commands · Enter to send)"
					}
					className="min-h-0 flex-1 resize-none rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-sm py-xs text-sm text-text outline-none placeholder:text-hint focus:border-primary"
				/>
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
	);
}
