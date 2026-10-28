import { RiCloseLine as X } from "@remixicon/react";
import { REQUEST_IMAGE_BASE64_BUDGET } from "@thinkrail/contracts";
import { t as translate, useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import {
	type ClipboardEvent,
	type DragEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useInsertionEffect,
	useRef,
	useState,
} from "react";
import { FileChip } from "./FileChip";
import type { AttachedImage } from "./imageAttachment";
import {
	insertPromptText,
	nativeClipboardBridge,
	type PreparedPromptFile,
	prepareClipboardPaste,
	preparePromptFiles,
} from "./promptFiles";
import type { ChatAttachment } from "./types";

export interface PromptImage extends AttachedImage {
	id: string;
	name: string;
}

export interface PromptImageError {
	id: string;
	name: string;
	reason: string;
}

export interface PromptImagesController {
	images: PromptImage[];
	pending: number;
	errors: PromptImageError[];
	addFiles: (files: File[]) => void;
	paste: (
		event: ClipboardEvent<HTMLTextAreaElement>,
		change: (value: string, caret: number) => void,
	) => void;
	removeImage: (id: string) => void;
	dismissError: (id: string) => void;
	restore: (attachments: ChatAttachment[]) => void;
	reset: () => void;
}

export function usePromptPasteDropHandlers(
	controller: Pick<PromptImagesController, "addFiles" | "paste">,
	change: (value: string, caret: number) => void,
): {
	onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
	onDrop: (e: DragEvent<HTMLElement>) => void;
} {
	const changeRef = useRef(change);
	useInsertionEffect(() => { changeRef.current = change; });
	return {
		onPaste: (e) => controller.paste(e, (value, caret) => changeRef.current(value, caret)),
		onDrop: (e) => {
			const files = [...e.dataTransfer.files];
			if (files.length === 0) return;
			e.preventDefault();
			controller.addFiles(files);
		},
	};
}

export function usePromptImages(): PromptImagesController {
	const [images, setImages] = useState<PromptImage[]>([]);
	const imagesRef = useRef<PromptImage[]>([]);
	const [pending, setPending] = useState(0);
	const [errors, setErrors] = useState<PromptImageError[]>([]);
	const generation = useRef(0);
	const pendingRef = useRef(0);
	useEffect(
		() => () => {
			generation.current += 1;
		},
		[],
	);

	const commit = useCallback((next: PromptImage[]) => {
		imagesRef.current = next;
		setImages(next);
	}, []);

	const reportError = useCallback((reason: string) => {
		setErrors((prev) => [
			...prev,
			{
				id: crypto.randomUUID(),
				name: translate("chat.promptImages.clipboard"),
				reason,
			},
		]);
	}, []);

	const receiveFiles = useCallback(
		(files: PreparedPromptFile[]) => {
			let used = imagesRef.current.reduce((sum, image) => sum + image.content.data.length, 0);
			const additions: PromptImage[] = [];
			const paths: string[] = [];
			const nextErrors: PromptImageError[] = [];
			for (const file of files) {
				const size = file.image?.content.data.length ?? 0;
				if (file.image && used + size <= REQUEST_IMAGE_BASE64_BUDGET) {
					used += size;
					additions.push({ id: crypto.randomUUID(), name: file.name, ...file.image });
				} else if (file.path) {
					paths.push(file.path);
				} else {
					nextErrors.push({
						id: crypto.randomUUID(),
						name: file.name || translate("chat.promptImages.fallbackName"),
						reason: translate(
							file.image
								? "chat.promptImages.limitReached"
								: file.error === "unsupported"
									? "chat.promptImages.unsupported"
									: "chat.promptImages.pathUnavailable",
						),
					});
				}
			}
			if (additions.length > 0) commit([...imagesRef.current, ...additions]);
			if (nextErrors.length > 0) setErrors((prev) => [...prev, ...nextErrors]);
			return paths;
		},
		[commit],
	);

	const run = useCallback(
		(
			prepare: () => Promise<{ files: PreparedPromptFile[]; text: string }>,
			isCurrent: () => boolean,
			insert: (text: string, paths: string[]) => void,
		) => {
			const startedGeneration = generation.current;
			pendingRef.current += 1;
			setPending(pendingRef.current);
			void prepare()
				.then((result) => {
					if (startedGeneration !== generation.current) return;
					if (!isCurrent()) {
						reportError(translate("chat.promptImages.draftChanged"));
						return;
					}
					const paths = receiveFiles(result.files);
					if (result.text || paths.length > 0) insert(result.text, paths);
				})
				.catch(() => {
					if (startedGeneration === generation.current)
						reportError(translate("chat.promptImages.clipboardFailed"));
				})
				.finally(() => {
					if (startedGeneration !== generation.current) return;
					pendingRef.current -= 1;
					setPending(pendingRef.current);
				});
		},
		[receiveFiles, reportError],
	);

	const addFiles = useCallback(
		(files: File[]) => {
			if (files.length === 0) return;
			run(
				async () => ({ files: await preparePromptFiles(files), text: "" }),
				() => true,
				() => {},
			);
		},
		[run],
	);

	const paste = useCallback(
		(
			event: ClipboardEvent<HTMLTextAreaElement>,
			change: (value: string, caret: number) => void,
		) => {
			const files = [...event.clipboardData.files];
			const bridge = nativeClipboardBridge();
			if (files.length === 0 && !bridge) return;
			event.preventDefault();
			if (pendingRef.current > 0) {
				reportError(translate("chat.promptImages.pastePending"));
				return;
			}
			const target = event.currentTarget;
			const value = target.value;
			const start = target.selectionStart;
			const end = target.selectionEnd;
			const text = event.clipboardData.getData("text/plain");
			run(
				() => prepareClipboardPaste(files, text, bridge),
				() => target.isConnected && target.value === value,
				(content, paths) => {
					const next = insertPromptText(value, start, end, content, paths);
					change(next.value, next.caret);
				},
			);
		},
		[run, reportError],
	);

	const removeImage = useCallback(
		(id: string) => commit(imagesRef.current.filter((p) => p.id !== id)),
		[commit],
	);

	const dismissError = useCallback(
		(id: string) => setErrors((prev) => prev.filter((p) => p.id !== id)),
		[],
	);

	const restore = useCallback(
		(attachments: ChatAttachment[]) => {
			if (attachments.length === 0) return;
			commit([
				...attachments.map((attachment) => ({ id: crypto.randomUUID(), ...attachment })),
				...imagesRef.current,
			]);
		},
		[commit],
	);

	const reset = useCallback(() => {
		generation.current += 1;
		pendingRef.current = 0;
		setPending(0);
		commit([]);
		setErrors([]);
	}, [commit]);

	return { images, pending, errors, addFiles, paste, removeImage, dismissError, restore, reset };
}

// Padding presets for the chip strip. Both surfaces align the strip with the input field's left
// edge and leave the same 12px gap below it; they differ only in structure — the composer strip
// sits above a `p-12` input shell (so it owns its own left/top padding), while the dialog textarea
// is flush (so only the bottom gap is needed).
export const PROMPT_IMAGE_CHIPS_PADDING = {
	composer: "px-12 pt-12",
	dialog: "pb-12",
} as const;

export function PromptImageChips({
	controller,
	leading,
	testId = "composer-images",
	className = PROMPT_IMAGE_CHIPS_PADDING.composer,
}: {
	controller: PromptImagesController;
	leading?: ReactNode;
	testId?: string;
	className?: string;
}) {
	const t = useT();
	const { images, pending, errors, removeImage, dismissError } = controller;
	if (!leading && images.length === 0 && pending === 0 && errors.length === 0) return null;
	return (
		<div className={cn("flex flex-wrap gap-4", className)} data-testid={testId}>
			{leading}
			{errors.map((err) => (
				<FileChip
					key={err.id}
					data-testid="composer-image-error"
					tone="error"
					icon={false}
					title={t("chat.promptImages.attachFailedDetail", { name: err.name, reason: err.reason })}
					label={t("chat.promptImages.attachFailed", { name: err.name })}
					meta={`— ${err.reason}`}
					trailing={
						<button
							type="button"
							aria-label={t("common.dismiss")}
							onClick={() => dismissError(err.id)}
							className="hover:opacity-80"
						>
							<X className="size-14" />
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
						<IconButton
							icon={X}
							size="s"
							label={t("chat.promptImages.remove")}
							onClick={() => removeImage(img.id)}
						/>
					}
				/>
			))}
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
		</div>
	);
}
