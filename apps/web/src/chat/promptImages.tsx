import {
	RiFileZipLine as ArchiveFileIcon,
	RiFileMusicLine as AudioFileIcon,
	RiFileCodeLine as CodeFileIcon,
	RiFileLine as FileIcon,
	RiAttachment2 as Paperclip,
	RiFilePdf2Line as PdfFileIcon,
	RiFileTextLine as TextFileIcon,
	RiFileVideoLine as VideoFileIcon,
	RiCloseLine as X,
} from "@remixicon/react";
import {
	attachmentImageType,
	type NativeClipboardContent,
	type NativeClipboardFile,
	REQUEST_IMAGE_BASE64_BUDGET,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { localeOf, t as translate, useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { cn } from "@thinkrail/ui/utils";
import {
	type ClipboardEvent,
	type DragEvent,
	type KeyboardEvent,
	type ReactNode,
	type Ref,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { randomUuid } from "../lib";
import {
	newPromptImagesState,
	type PromptFile,
	type PromptFileSource,
	type PromptImage,
	type PromptImageError,
	type PromptImagesState,
	withCopiedPromptFile,
	withoutPromptChips,
	withPendingWork,
} from "../store";
import {
	base64ToBytes,
	chipKeyAction,
	dragMayCarryFiles,
	dropHidesFiles,
	fileAttachmentRefusal,
	formatFileSize,
	pasteMayHideFiles,
	readNativeClipboardBridge,
} from "./attachments";
import { FileChip } from "./FileChip";
import { fileToAttachedImage } from "./imageAttachment";
import type { ChatAttachment } from "./types";

export interface PromptImagesOwner {
	state: PromptImagesState;
	read: () => PromptImagesState;
	update: (change: (current: PromptImagesState) => PromptImagesState) => void;
}

export interface PendingWork {
	current: () => boolean;
	release: () => void;
}

export interface PromptImagesController {
	images: PromptImage[];
	files: PromptFile[];
	pending: number;
	uploading: boolean;
	errors: PromptImageError[];
	reserve: () => PendingWork | null;
	addFiles: (files: File[]) => void;
	addClipboard: (content: NativeClipboardContent) => void;
	remove: (id: string) => void;
	restore: (attachments: ChatAttachment[]) => void;
	holdForUpload: (upload: AbortController) => () => void;
	cancelUpload: () => void;
	markCopied: (id: string, path: string) => void;
	clearSent: (ids: readonly string[]) => void;
	reset: () => void;
}

interface FileEntry {
	name: string;
	size: number;
	source: PromptFileSource;
}

function pastedImageName(mimeType: string): string {
	return `image.${mimeType.slice(mimeType.indexOf("/") + 1)}`;
}

function imageFile(name: string, mimeType: string, data: string): File {
	return new File([base64ToBytes(data)], name, { type: mimeType });
}

function isImageFile(file: { name: string; type: string }): boolean {
	return attachmentImageType(file) !== null;
}

function isPastedImage(file: NativeClipboardFile): boolean {
	return attachmentImageType({ name: file.name, type: "" }) !== null;
}

export function attachmentPasteDropHandlers(
	controller: Pick<PromptImagesController, "addFiles" | "addClipboard" | "reserve">,
	notify: (message: string) => void,
): {
	onPaste: (e: ClipboardEvent<HTMLElement>) => void;
	onDragOver: (e: DragEvent<HTMLElement>) => void;
	onDrop: (e: DragEvent<HTMLElement>) => void;
} {
	return {
		onPaste: (e) => {
			const files = [...e.clipboardData.files];
			if (files.length > 0) {
				e.preventDefault();
				controller.addFiles(files);
				return;
			}
			const bridge = readNativeClipboardBridge();
			const text = e.clipboardData.getData("text/plain");
			if (!bridge || !pasteMayHideFiles([...e.clipboardData.types], text)) return;
			e.preventDefault();
			const work = controller.reserve();
			if (!work) return;
			const field = e.currentTarget;
			void bridge
				.read()
				.catch((): NativeClipboardContent => ({ kind: "unreadable" }))
				.then((content) => {
					if (!work.current()) return;
					if (
						content.kind === "image" ||
						content.kind === "files" ||
						content.kind === "oversized"
					) {
						controller.addClipboard(content);
					} else if (text) {
						if (!field.isConnected) return;
						field.focus();
						document.execCommand("insertText", false, text);
					} else if (content.kind === "unreadable") {
						notify(translate("chat.attachments.pasteUnreadable"));
					}
				})
				.finally(work.release);
		},
		onDragOver: (e) => {
			if (!dragMayCarryFiles([...e.dataTransfer.types])) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = "copy";
		},
		onDrop: (e) => {
			const files = [...e.dataTransfer.files];
			if (files.length > 0) {
				e.preventDefault();
				controller.addFiles(files);
				return;
			}
			const types = [...e.dataTransfer.types];
			if (dropHidesFiles(types, 0, e.dataTransfer.getData("text/uri-list"))) {
				e.preventDefault();
				notify(
					translate(
						readNativeClipboardBridge()
							? "chat.attachments.dropUnavailable"
							: "chat.attachments.dropEmptied",
					),
				);
				return;
			}
			const editable =
				e.target instanceof HTMLTextAreaElement ||
				(e.target instanceof HTMLElement && e.target.isContentEditable);
			if (dragMayCarryFiles(types) && !editable) e.preventDefault();
		},
	};
}

export function usePromptImages(
	owner?: PromptImagesOwner,
	acceptsFiles = true,
): PromptImagesController {
	const [local, setLocal] = useState(newPromptImagesState);
	const localRef = useRef(local);
	const { images, files, pending, upload, errors } = owner?.state ?? local;
	const read = useCallback(() => owner?.read() ?? localRef.current, [owner]);
	const update = useCallback(
		(change: (current: PromptImagesState) => PromptImagesState) => {
			if (owner) owner.update(change);
			else {
				localRef.current = change(localRef.current);
				setLocal(localRef.current);
			}
		},
		[owner],
	);

	const addImages = useCallback(
		(picked: File[]) => {
			if (picked.length === 0) return;
			const startedGeneration = read().generation;
			update((current) => withPendingWork(current, startedGeneration, picked.length));
			const decode = async () => {
				const settled = await Promise.allSettled(picked.map(fileToAttachedImage));
				update((current) => {
					if (current.generation !== startedGeneration) return current;
					let used = current.images.reduce((sum, p) => sum + p.content.data.length, 0);
					const additions: PromptImage[] = [];
					const nextErrors: PromptImageError[] = [];
					settled.forEach((result, i) => {
						const name = picked[i]?.name || translate("chat.promptImages.fallbackName");
						if (result.status !== "fulfilled" || result.value === null) {
							nextErrors.push({
								id: randomUuid(),
								name,
								reason: translate("chat.promptImages.unsupported"),
							});
							return;
						}
						const size = result.value.content.data.length;
						if (used + size > REQUEST_IMAGE_BASE64_BUDGET) {
							nextErrors.push({
								id: randomUuid(),
								name,
								reason: translate("chat.promptImages.limitReached"),
							});
							return;
						}
						used += size;
						additions.push({ id: randomUuid(), name, ...result.value });
					});
					return {
						...current,
						images: [...current.images, ...additions],
						errors: [...current.errors, ...nextErrors],
					};
				});
			};
			void decode().finally(() =>
				update((current) => withPendingWork(current, startedGeneration, -picked.length)),
			);
		},
		[read, update],
	);

	const addEntries = useCallback(
		(entries: FileEntry[], refusedImages: readonly string[] = []) => {
			if (entries.length === 0 && refusedImages.length === 0) return;
			update((current) => {
				const additions: PromptFile[] = [];
				const nextErrors: PromptImageError[] = refusedImages.map((name) => ({
					id: randomUuid(),
					name,
					reason: translate("chat.attachments.pasteTooLarge"),
				}));
				for (const entry of entries) {
					const reason = fileAttachmentRefusal(entry.size, acceptsFiles);
					if (reason === null) additions.push({ id: randomUuid(), ...entry });
					else nextErrors.push({ id: randomUuid(), name: entry.name, reason });
				}
				return {
					...current,
					files: [...current.files, ...additions],
					errors: [...current.errors, ...nextErrors],
				};
			});
		},
		[update, acceptsFiles],
	);

	const reserve = useCallback((): PendingWork | null => {
		const started = read();
		if (started.upload) return null;
		const { generation } = started;
		update((current) => withPendingWork(current, generation, 1));
		return {
			current: () => read().generation === generation,
			release: () => update((current) => withPendingWork(current, generation, -1)),
		};
	}, [read, update]);

	const addFiles = useCallback(
		(picked: File[]) => {
			if (read().upload) return;
			addImages(picked.filter(isImageFile));
			addEntries(
				picked
					.filter((file) => !isImageFile(file))
					.map((file) => ({
						name: file.name,
						size: file.size,
						source: { kind: "blob", blob: file },
					})),
			);
		},
		[read, addImages, addEntries],
	);

	const addClipboard = useCallback(
		(content: NativeClipboardContent) => {
			if (read().upload) return;
			if (content.kind === "image") {
				addImages([imageFile(pastedImageName(content.mimeType), content.mimeType, content.data)]);
				return;
			}
			if (content.kind === "oversized") {
				addEntries([], [pastedImageName("image/png")]);
				return;
			}
			if (content.kind !== "files") return;
			const pasted = content.files;
			addImages(
				pasted.flatMap((file) =>
					file.image ? [imageFile(file.name, file.image.mimeType, file.image.data)] : [],
				),
			);
			addEntries(
				pasted
					.filter((file) => !file.image && !isPastedImage(file))
					.map((file) => ({
						name: file.name,
						size: file.size,
						source: { kind: "local", path: file.path },
					})),
				pasted.filter((file) => !file.image && isPastedImage(file)).map((file) => file.name),
			);
		},
		[read, addImages, addEntries],
	);

	const remove = useCallback(
		(id: string) =>
			update((current) => (current.upload ? current : withoutPromptChips(current, [id]))),
		[update],
	);

	const restore = useCallback(
		(attachments: ChatAttachment[]) => {
			if (attachments.length === 0) return;
			update((current) => ({
				...current,
				images: [
					...attachments.map((attachment) => ({ id: randomUuid(), ...attachment })),
					...current.images,
				],
			}));
		},
		[update],
	);

	const holdForUpload = useCallback(
		(held: AbortController) => {
			update((current) => ({ ...current, upload: held }));
			return () =>
				update((current) => (current.upload === held ? { ...current, upload: null } : current));
		},
		[update],
	);

	const cancelUpload = useCallback(() => read().upload?.abort(), [read]);

	const markCopied = useCallback(
		(id: string, path: string) => update((current) => withCopiedPromptFile(current, id, path)),
		[update],
	);

	const clearSent = useCallback(
		(ids: readonly string[]) => update((current) => withoutPromptChips(current, ids)),
		[update],
	);

	const reset = useCallback(() => {
		update(newPromptImagesState);
	}, [update]);

	return {
		images,
		files,
		pending,
		uploading: upload !== null,
		errors,
		reserve,
		addFiles,
		addClipboard,
		remove,
		restore,
		holdForUpload,
		cancelUpload,
		markCopied,
		clearSent,
		reset,
	};
}

export function AttachFilesButton({
	onFiles,
	onPicked,
	disabled,
	testId = "attach-files",
}: {
	onFiles: (files: File[]) => void;
	onPicked: () => void;
	disabled?: boolean;
	testId?: string;
}) {
	const t = useT();
	const buttonRef = useRef<HTMLButtonElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		const input = inputRef.current;
		if (!input) return;
		const onCancel = () => buttonRef.current?.focus();
		input.addEventListener("cancel", onCancel);
		return () => input.removeEventListener("cancel", onCancel);
	}, []);
	return (
		<>
			<IconButton
				ref={buttonRef}
				tabIndex={0}
				icon={Paperclip}
				data-testid={testId}
				label={t("chat.attachments.attach")}
				disabled={disabled}
				onClick={() => inputRef.current?.click()}
			/>
			<input
				ref={inputRef}
				type="file"
				multiple
				hidden
				tabIndex={-1}
				aria-hidden
				data-testid={`${testId}-input`}
				onChange={(e) => {
					const picked = [...(e.currentTarget.files ?? [])];
					e.currentTarget.value = "";
					if (picked.length > 0) onFiles(picked);
					onPicked();
				}}
			/>
		</>
	);
}

export interface PromptChipsHandle {
	focus: () => boolean;
}

type ChipItem =
	| { kind: "error"; id: string; error: PromptImageError }
	| { kind: "image"; id: string; image: PromptImage }
	| { kind: "file"; id: string; file: PromptFile };

const FILE_ICONS: readonly [RegExp, typeof FileIcon][] = [
	[/\.pdf$/i, PdfFileIcon],
	[/\.(mp4|mov|m4v|webm|mkv|avi)$/i, VideoFileIcon],
	[/\.(mp3|wav|m4a|ogg|flac|aac)$/i, AudioFileIcon],
	[/\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i, ArchiveFileIcon],
	[
		/\.(ts|tsx|js|jsx|py|rs|go|java|kt|c|cc|cpp|h|rb|swift|sh|json|ya?ml|toml|html|css)$/i,
		CodeFileIcon,
	],
	[/\.(txt|md|csv|log|rtf|docx?|odt)$/i, TextFileIcon],
];

function FileKindIcon({ name }: { name: string }) {
	const Icon = FILE_ICONS.find(([pattern]) => pattern.test(name))?.[1] ?? FileIcon;
	return <Icon aria-hidden className="size-14 shrink-0 text-text-muted" />;
}

function chipItems(controller: PromptImagesController): ChipItem[] {
	return [
		...controller.errors.map((error): ChipItem => ({ kind: "error", id: error.id, error })),
		...controller.images.map((image): ChipItem => ({ kind: "image", id: image.id, image })),
		...controller.files.map((file): ChipItem => ({ kind: "file", id: file.id, file })),
	];
}

const FILE_DESTINATION = {
	workspace: {
		badge: "chat.attachments.toWorkspace",
		title: "chat.attachments.fileTitle",
		option: "chat.attachments.fileChip",
	},
	dataDir: {
		badge: "chat.attachments.toDataDir",
		title: "chat.attachments.fileTitleDataDir",
		option: "chat.attachments.fileChipDataDir",
	},
} as const satisfies Record<string, Record<"badge" | "title" | "option", MessageKey>>;

export function PromptImageChips({
	controller,
	leading,
	testId = "composer-images",
	className = "px-12 pt-12",
	filesTo = "workspace",
	locked = false,
	onField,
	onTabOut,
	handleRef,
}: {
	controller: PromptImagesController;
	leading?: ReactNode;
	testId?: string;
	className?: string;
	filesTo?: keyof typeof FILE_DESTINATION;
	locked?: boolean;
	onField: () => void;
	onTabOut?: (backward: boolean) => void;
	handleRef?: Ref<PromptChipsHandle>;
}) {
	const t = useT();
	const { pending, uploading, remove, cancelUpload } = controller;
	const held = uploading || locked;
	const destination = FILE_DESTINATION[filesTo];
	const items = chipItems(controller);
	const [activeId, setActiveId] = useState<string | null>(null);
	const chipRefs = useRef(new Map<string, HTMLDivElement>());
	const pendingFocus = useRef<string | null>(null);
	const active = items.find((item) => item.id === activeId) ?? items[0];

	const focusChip = (id: string) => {
		setActiveId(id);
		pendingFocus.current = id;
		chipRefs.current.get(id)?.focus();
	};

	useEffect(() => {
		const id = pendingFocus.current;
		if (id === null) return;
		pendingFocus.current = null;
		const chip = chipRefs.current.get(id);
		if (chip && document.activeElement !== chip) chip.focus();
	});

	useImperativeHandle(handleRef, () => ({
		focus: () => {
			if (!active) return false;
			focusChip(active.id);
			return true;
		},
	}));

	const removeAt = (index: number, next: number | null) => {
		const item = items[index];
		if (!item || held) return;
		const rest = items.filter((other) => other.id !== item.id);
		remove(item.id);
		const target = next === null ? undefined : rest[next];
		if (target) focusChip(target.id);
		else onField();
	};

	const onChipKeyDown = (index: number) => (e: KeyboardEvent<HTMLDivElement>) => {
		if (isImeComposing(e.nativeEvent) || e.target !== e.currentTarget) return;
		if (e.altKey || e.ctrlKey || e.metaKey) return;
		if (e.key === "Tab" && onTabOut) {
			e.preventDefault();
			onTabOut(e.shiftKey);
			return;
		}
		if (e.shiftKey) return;
		const action = chipKeyAction(e.key, index, items.length);
		if (!action) return;
		e.preventDefault();
		if (action.kind === "field") onField();
		else if (action.kind === "remove") removeAt(action.index, action.next);
		else {
			const target = items[action.index];
			if (target) focusChip(target.id);
		}
	};

	if (!leading && items.length === 0 && pending === 0) return null;
	const chip = (item: ChipItem, index: number) => {
		const removeButton = (label: string) => (
			<IconButton
				icon={X}
				size="s"
				tabIndex={-1}
				label={label}
				disabled={held}
				onClick={() => removeAt(index, index < items.length - 1 ? index : index - 1)}
			/>
		);
		if (item.kind === "error") {
			const { error } = item;
			return (
				<FileChip
					data-testid="composer-image-error"
					tone="error"
					icon={false}
					title={t("chat.promptImages.attachFailedDetail", {
						name: error.name,
						reason: error.reason,
					})}
					label={t("chat.promptImages.attachFailed", { name: error.name })}
					meta={`— ${error.reason}`}
					trailing={removeButton(t("common.dismiss"))}
				/>
			);
		}
		if (item.kind === "image") {
			const { image } = item;
			return (
				<FileChip
					data-testid="composer-image"
					data-width={image.width}
					data-height={image.height}
					data-mime={image.content.mimeType}
					title={t("chat.attachments.imageTitle", { name: image.name })}
					visual={
						<img
							alt=""
							src={`data:${image.content.mimeType};base64,${image.content.data}`}
							className="h-16 w-24 shrink-0 rounded-xs object-cover"
						/>
					}
					label={image.name}
					meta={image.width && image.height ? ` · ${image.width}×${image.height}` : undefined}
					trailing={removeButton(t("chat.promptImages.remove"))}
				/>
			);
		}
		const { file } = item;
		return (
			<FileChip
				data-testid="composer-file"
				title={t(destination.title, { name: file.name })}
				visual={<FileKindIcon name={file.name} />}
				label={file.name}
				meta={
					<>
						{` · ${formatFileSize(file.size, localeOf(t))}`}
						<span className="ml-4 rounded-full border border-feedback-success-muted bg-feedback-success-subtle px-4 text-feedback-success">
							{t(destination.badge)}
						</span>
					</>
				}
				trailing={removeButton(t("chat.attachments.remove"))}
			/>
		);
	};
	const optionLabel = (item: ChipItem) =>
		item.kind === "error"
			? t("chat.promptImages.attachFailedDetail", {
					name: item.error.name,
					reason: item.error.reason,
				})
			: item.kind === "image"
				? t("chat.attachments.imageChip", { name: item.image.name })
				: t(destination.option, { name: item.file.name });
	return (
		<div className={cn("flex flex-wrap gap-4", className)} data-testid={testId}>
			{leading}
			{items.length > 0 ? (
				<div
					role="listbox"
					aria-label={t("chat.attachments.listLabel")}
					aria-orientation="horizontal"
					className="flex min-w-0 max-w-full flex-wrap gap-4"
				>
					{items.map((item, index) => (
						<div
							key={item.id}
							role="option"
							aria-selected={item.id === active?.id}
							aria-label={optionLabel(item)}
							data-testid="composer-chip"
							data-kind={item.kind}
							tabIndex={!onTabOut && item.id === active?.id ? 0 : -1}
							ref={(el) => {
								if (el) chipRefs.current.set(item.id, el);
								else chipRefs.current.delete(item.id);
							}}
							onKeyDown={onChipKeyDown(index)}
							onFocus={(e) => {
								if (e.target === e.currentTarget) setActiveId(item.id);
							}}
							className="flex min-w-0 max-w-full rounded-sm outline-none focus-visible:focus-ring"
						>
							{chip(item, index)}
						</div>
					))}
				</div>
			) : null}
			{pending > 0 ? (
				<FileChip
					data-testid="composer-image-pending"
					label={
						<span className="text-text-muted">
							{t("chat.promptImages.attaching", { count: pending })}
						</span>
					}
				/>
			) : null}
			{uploading ? (
				<FileChip
					data-testid="composer-files-uploading"
					label={<span className="text-text-muted">{t("chat.attachments.uploading")}</span>}
					trailing={
						<IconButton
							icon={X}
							size="s"
							tabIndex={-1}
							data-testid="composer-files-uploading-cancel"
							label={t("chat.attachments.cancelUpload")}
							onClick={cancelUpload}
						/>
					}
				/>
			) : null}
		</div>
	);
}
